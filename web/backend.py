from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import re
import socket
from contextlib import suppress
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from concurrent.futures import ThreadPoolExecutor

from .api import models, session
from .api.playlists import store as playlist_store
from .api.session import ALBUM_TRACK_TIMEOUT, SEARCH_SOURCE_TIMEOUT, _is_http_url as _is_http

logger = logging.getLogger("musicdl.web")

# 上游直链「过期」的典型状态码：命中则强制重解一条新直链。其余 4xx（如 416 Range
# Not Satisfiable，常见于 <audio> seek）不视为过期，避免无谓重解打乱播放。
_EXPIRED_LINK_STATUSES = frozenset({401, 403, 404, 410})

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# 专辑解析专用线程池：超时被放弃的曲目线程仍会在后台跑完（最长 ~80s），放在独立池里
# 隔离，避免这些“僵尸”线程占满默认 executor 拖慢搜索等其它接口。
_album_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="album-resolve")

# 可选鉴权 token：设置 MUSICDL_AUTH_TOKEN 后，所有 /api/* 需带 ?token= 或
# Authorization: Bearer 才放行（适合放公网/反代场景）。默认不设 = 不鉴权（本机使用）。
_AUTH_TOKEN = os.environ.get("MUSICDL_AUTH_TOKEN", "").strip()


def _is_safe_public_url(url: str) -> bool:
    """SSRF 防护：仅允许 http(s) 且主机解析到公网地址的 URL。

    拒绝环回/私网/链路本地/保留/多播地址，防止被用来探测内网或读取云元数据
    （如 169.254.169.254）。主机会做 DNS 解析并校验所有解析结果。
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        infos = socket.getaddrinfo(parsed.hostname, None)
    except Exception:
        return False
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
    return True


app = FastAPI(title="musicdl web", version="1.0.0")

# CORS：默认仅放行本机来源（SPA 与后端同源，按 IP 访问也是同源，无需 CORS）；
# 跨站 JS 想读取本地 API 会被浏览器拦下。需放开可设 MUSICDL_CORS_ORIGINS（逗号分隔，
# 或单个 "*"）。
_cors_env = os.environ.get("MUSICDL_CORS_ORIGINS", "").strip()
if _cors_env == "*":
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
elif _cors_env:
    _origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def _auth_guard(request: Request, call_next):
    """启用 MUSICDL_AUTH_TOKEN 时，校验 /api/* 的 token（支持 Bearer 头或 ?token=）。"""
    if _AUTH_TOKEN and request.url.path.startswith("/api/"):
        header = request.headers.get("authorization", "")
        token = header[7:].strip() if header[:7].lower() == "bearer " else request.query_params.get("token", "")
        if token != _AUTH_TOKEN:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


# ---------- sources ----------
@app.get("/api/sources")
def get_sources() -> dict:
    available = session.available_sources()
    enabled = set(session.enabled_sources())
    return {
        "enabled": [s for s in session.enabled_sources()],
        "available": [{"name": s, "enabled": s in enabled} for s in available],
    }


# ---------- search ----------
@app.get("/api/search", response_model=models.SearchResponse)
def search(keyword: str = Query(..., min_length=1)) -> models.SearchResponse:
    songs = session.search(keyword)
    return models.SearchResponse(keyword=keyword, total=len(songs), songs=[models.SongInfoOut(**s) for s in songs])


@app.get("/api/search/stream")
async def search_stream(keyword: str = Query(..., min_length=1), page: int = Query(1, ge=1)):
    """流式搜索：各源在独立线程并发检索，谁先算完谁先推送（快源 1~2 秒即显示）。

    关键：用 asyncio.to_thread + as_completed，不阻塞事件循环，保证每批结果即时下发；
    之前用阻塞的 concurrent.futures.as_completed 会卡住事件循环，导致所有源攒到最后一起返回。
    """
    import asyncio
    import json

    sources = session.enabled_sources()

    async def run_one(ms: str):
        try:
            return ms, await asyncio.wait_for(
                asyncio.to_thread(session.search_source, ms, keyword, page),
                timeout=SEARCH_SOURCE_TIMEOUT,
            )
        except Exception:
            # 超时或异常：跳过该源（后台线程仍会算完并写入缓存，下次同词秒回）
            return ms, []

    async def event_gen():
        tasks = [asyncio.create_task(run_one(ms)) for ms in sources]
        done_count = 0
        for coro in asyncio.as_completed(tasks):
            ms, songs = await coro
            done_count += 1
            payload = {"source": ms, "done": done_count, "total_sources": len(sources), "songs": songs}
            yield {"event": "batch", "data": json.dumps(payload, ensure_ascii=False)}
        yield {"event": "done", "data": json.dumps({"total_sources": len(sources)}, ensure_ascii=False)}

    return EventSourceResponse(event_gen())


# ---------- album ----------
@app.get("/api/search/album", response_model=models.AlbumSearchResponse)
def search_album(keyword: str = Query(..., min_length=1)) -> models.AlbumSearchResponse:
    albums = session.search_album(keyword)
    return models.AlbumSearchResponse(keyword=keyword, total=len(albums), albums=[models.AlbumInfoOut(**a) for a in albums])


@app.post("/api/album", response_model=models.PlaylistResponse)
def album(req: models.AlbumRequest) -> models.PlaylistResponse:
    songs = session.parse_album(req.album_id, req.source)
    return models.PlaylistResponse(total=len(songs), songs=[models.SongInfoOut(**s) for s in songs])


def _stream_tracks(resolve_source: str | None, tracks: list) -> EventSourceResponse:
    """流式逐首解析曲目的通用 SSE 响应：先下发总数，再并发解析、解一首推一首，
    携带 index 让前端按原始顺序插入。专辑/歌单共用。

    关键：客户端断开（切走/返回）时 sse-starlette 取消 event_gen，finally 里取消所有
    未完成任务，避免被放弃的解析继续占满 _album_pool（大歌单尤甚）。
    """
    total = len(tracks)

    async def event_gen():
        sem = asyncio.Semaphore(8)  # 限制并发，避免一次性打爆上游

        async def resolve_one(index: int, track: dict):
            async with sem:
                loop = asyncio.get_running_loop()
                try:
                    # 逐首超时：可解析的歌 1~2s 即返回；完全受限的歌会一直轮三方接口，
                    # 超时即跳过（返回 None），保证整体不卡死（被放弃的线程在独立池里跑完）。
                    song = await asyncio.wait_for(
                        loop.run_in_executor(_album_pool, session.resolve_album_track, resolve_source, track),
                        timeout=ALBUM_TRACK_TIMEOUT,
                    )
                except (asyncio.TimeoutError, Exception):
                    song = None
                return index, song

        yield {"event": "meta", "data": json.dumps({"total": total}, ensure_ascii=False)}
        tasks = [asyncio.create_task(resolve_one(i, t)) for i, t in enumerate(tracks)]
        try:
            done = 0
            for coro in asyncio.as_completed(tasks):
                index, song = await coro
                done += 1
                payload = {"done": done, "total": total, "index": index, "song": song}
                yield {"event": "track", "data": json.dumps(payload, ensure_ascii=False)}
            yield {"event": "done", "data": json.dumps({"total": total}, ensure_ascii=False)}
        finally:
            for t in tasks:
                if not t.done():
                    t.cancel()

    return EventSourceResponse(event_gen())


@app.get("/api/album/stream")
async def album_stream(album_id: str = Query(..., min_length=1), source: str | None = Query(None)):
    """流式解析专辑：解一首出现一首，避免整张专辑整批阻塞。"""
    tracks, _name = await asyncio.to_thread(session.album_tracks_meta, album_id, source)
    return _stream_tracks(source, tracks)


# ---------- playlist (外部歌单链接解析) ----------
@app.post("/api/playlist", response_model=models.PlaylistResponse)
def playlist(req: models.PlaylistRequest) -> models.PlaylistResponse:
    songs = session.search_playlist(req.url)
    return models.PlaylistResponse(total=len(songs), songs=[models.SongInfoOut(**s) for s in songs])


@app.get("/api/playlist/stream")
async def playlist_stream(url: str = Query(..., min_length=1), source: str | None = Query(None)):
    """流式解析外部/热门歌单：解一首出现一首，避免百首歌单整批阻塞「一直解析」。"""
    src, tracks, _name = await asyncio.to_thread(session.playlist_tracks_meta, url, source)
    return _stream_tracks(src, tracks)


# ---------- hot playlists (热门/推荐歌单广场) ----------
@app.get("/api/hotplaylists", response_model=models.HotPlaylistResponse)
def hot_playlists(source: str = Query("NeteaseMusicClient", min_length=1)) -> models.HotPlaylistResponse:
    playlists = session.hot_playlists(source)
    return models.HotPlaylistResponse(
        source=source,
        total=len(playlists),
        playlists=[models.HotPlaylistOut(**p) for p in playlists],
    )


# ---------- playlists (个人收藏歌单, 持久化) ----------
@app.get("/api/playlists", response_model=models.PlaylistListResponse)
def list_playlists() -> models.PlaylistListResponse:
    return models.PlaylistListResponse(playlists=[models.PlaylistSummary(**p) for p in playlist_store.list_summaries()])


@app.post("/api/playlists", response_model=models.PlaylistSummary)
def create_playlist(req: models.PlaylistCreateRequest) -> models.PlaylistSummary:
    return models.PlaylistSummary(**playlist_store.create(req.name))


@app.get("/api/playlists/{playlist_id}", response_model=models.PlaylistDetail)
def get_playlist(playlist_id: str) -> models.PlaylistDetail:
    p = playlist_store.get(playlist_id)
    if p is None:
        raise HTTPException(404, "playlist not found")
    return models.PlaylistDetail(**p)


@app.patch("/api/playlists/{playlist_id}", response_model=models.PlaylistSummary)
def rename_playlist(playlist_id: str, req: models.PlaylistRenameRequest) -> models.PlaylistSummary:
    p = playlist_store.rename(playlist_id, req.name)
    if p is None:
        raise HTTPException(404, "playlist not found")
    return models.PlaylistSummary(**p)


@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str) -> dict:
    if not playlist_store.delete(playlist_id):
        raise HTTPException(404, "playlist not found")
    return {"ok": True}


@app.post("/api/playlists/{playlist_id}/songs", response_model=models.PlaylistDetail)
def add_playlist_song(playlist_id: str, req: models.PlaylistAddSongRequest) -> models.PlaylistDetail:
    p = playlist_store.add_song(playlist_id, req.song.model_dump())
    if p is None:
        raise HTTPException(404, "playlist not found")
    return models.PlaylistDetail(**p)


@app.delete("/api/playlists/{playlist_id}/songs/{song_id:path}", response_model=models.PlaylistDetail)
def remove_playlist_song(playlist_id: str, song_id: str) -> models.PlaylistDetail:
    p = playlist_store.remove_song(playlist_id, song_id)
    if p is None:
        raise HTTPException(404, "playlist not found")
    return models.PlaylistDetail(**p)


def _resolve_for_playback(song_id: str, force: bool = False):
    """取一首歌的可播放 SongInfo：缓存未命中或直链失效时，借歌名/歌手重解析。

    force=True 用于上游 CDN 实际返回 4xx（直链过期）时强制重解——过期直链仍是
    http 形态，无法靠字符串判断，必须以实际请求结果为准。歌名/歌手优先取缓存
    SongInfo 自身，其次取收藏歌单存的元数据，使搜索/专辑/热门歌单里的歌也能自愈。
    """
    info = session.get_song(song_id)
    if not force and info is not None and _is_http(info.download_url):
        return info
    name = info.song_name if info else None
    singers = info.singers if info else None
    if not name:
        meta = playlist_store.find_song(song_id)
        if meta:
            name, singers = meta.get("song_name"), meta.get("singers")
    return session.reresolve(song_id, name, singers, force=force) or info


def _open_upstream(song_id: str, info, extra_headers: dict | None = None):
    """请求上游直链；若直链过期（上游返回 4xx）则强制重解一次并重试。返回 (resp, info)。"""
    def do_get(inf):
        headers, cookies = session.download_io(inf)
        if extra_headers:
            headers.update(extra_headers)
        return requests.get(inf.download_url, headers=headers, cookies=cookies, stream=True, timeout=(10, 60))

    resp = do_get(info)
    if resp.status_code in _EXPIRED_LINK_STATUSES:
        with suppress(Exception):
            resp.close()
        fresh = _resolve_for_playback(song_id, force=True)
        if fresh is not None and _is_http(fresh.download_url) and fresh.download_url != info.download_url:
            info = fresh
            resp = do_get(info)
    return resp, info


# ---------- lyric ----------
_YRC_LINE = re.compile(r"^\[(\d+),(\d+)\]")
_YRC_WORD = re.compile(r"\((\d+),(\d+),\d+\)([^(]*)")


def _ms_tag(ms: int, bracket: bool) -> str:
    """毫秒 -> [mm:ss.xxx] / <mm:ss.xxx> 标签。"""
    if ms < 0:
        ms = 0
    body = f"{ms // 60000:02d}:{(ms % 60000) // 1000:02d}.{ms % 1000:03d}"
    return f"[{body}]" if bracket else f"<{body}>"


def _yrc_to_enhanced_lrc(yrc: str) -> str:
    """网易云逐字歌词(yrc) -> 增强型 LRC(行内 <时间> 逐字标签)，供前端逐字点亮。

    yrc 每行形如: [行起始ms,行时长ms](字起始ms,字时长ms,0)字...
    顶部的 {"t":...,"c":[...]} 元数据行直接跳过。
    """
    out: list[str] = []
    for line in yrc.splitlines():
        line = line.strip()
        if not line or line.startswith("{"):
            continue
        head = _YRC_LINE.match(line)
        if not head:
            continue
        line_start, line_dur = int(head.group(1)), int(head.group(2))
        words = _YRC_WORD.findall(line[head.end():])
        if not words:
            continue
        parts = [_ms_tag(line_start, True)]
        for w_start, _w_dur, text in words:
            parts.append(_ms_tag(int(w_start), False))
            parts.append(text)
        # 末尾补一个空时间标记，标出整行真正结束时间，避免最后一个字一直扫到下一行
        parts.append(_ms_tag(line_start + line_dur, False))
        out.append("".join(parts))
    return "\n".join(out)


def _fetch_netease_yrc(netease_id: str) -> str:
    """从网易云官方接口拉取逐字歌词并转为增强型 LRC；无逐字数据时返回空串。"""
    url = (
        "https://interface3.music.163.com/api/song/lyric/v1"
        f"?id={netease_id}&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0"
    )
    resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"}, timeout=8)
    resp.raise_for_status()
    yrc = ((resp.json().get("yrc") or {}).get("lyric") or "").strip()
    return _yrc_to_enhanced_lrc(yrc) if yrc else ""


@app.get("/api/lyric/{song_id}")
def lyric(song_id: str) -> dict:
    info = _resolve_for_playback(song_id)
    if info is None:
        raise HTTPException(404, "song not found")
    try:
        from musicdl.modules import SongInfoUtils
        # 尝试补充歌词
        if not info.lyric:
            info = SongInfoUtils.supplsonginfothensavelyricsthenwritetags(info, logger_handle=session.client.logger_handle, disable_print=True)
    except Exception:
        pass
    lyric_text = info.lyric or ""
    # 网易源：优先逐字歌词(yrc)，转成增强型 LRC 让前端做 Apple Music 式逐字点亮；失败则回退行级 LRC
    if info.source == "NeteaseMusicClient" and str(info.identifier or "").isdigit():
        with suppress(Exception):
            enhanced = _fetch_netease_yrc(str(info.identifier))
            if enhanced:
                lyric_text = enhanced
    return {"lyric": lyric_text, "song_name": info.song_name}


# ---------- stream (play proxy) ----------
@app.get("/api/stream/{song_id}")
def stream(song_id: str, request: Request) -> StreamingResponse:
    info = _resolve_for_playback(song_id)
    if info is None:
        raise HTTPException(404, "song not found")
    if not _is_http(info.download_url):
        raise HTTPException(400, "this source is not streamable in browser")

    # 透传浏览器的 Range 请求到上游 CDN，使 <audio> 可拖动/点击跳转到任意时间点
    range_header = request.headers.get("range")
    extra = {"Range": range_header} if range_header else None
    # 直链过期会被上游 CDN 拒（4xx），_open_upstream 会强制重解并重试一次
    req, info = _open_upstream(song_id, info, extra)
    # 416(Range Not Satisfiable) 是 seek 的正常响应，原样透传给浏览器；200/206 正常播放；
    # 其余（重解后仍失败）返回 502，而非把错误响应体当音频流回去（否则前端「点了没反应」）。
    if req.status_code not in (200, 206, 416):
        with suppress(Exception):
            req.close()
        raise HTTPException(502, "upstream link expired, retry later")
    content_type = req.headers.get("Content-Type", "audio/mpeg")

    # 回传可跳转所需的响应头（206 + Content-Range + Accept-Ranges + Content-Length）
    resp_headers = {"Accept-Ranges": req.headers.get("Accept-Ranges", "bytes")}
    for h in ("Content-Range", "Content-Length"):
        if req.headers.get(h):
            resp_headers[h] = req.headers[h]
    status_code = req.status_code if req.status_code in (200, 206, 416) else 200

    def iter_chunks():
        try:
            for chunk in req.iter_content(chunk_size=1024 * 256):
                if chunk:
                    yield chunk
        except (requests.exceptions.ChunkedEncodingError, requests.exceptions.ConnectionError):
            # 客户端断开（切歌/暂停/seek）或上游连接中断，静默退出
            pass
        finally:
            with suppress(Exception):
                req.close()

    return StreamingResponse(iter_chunks(), status_code=status_code, media_type=content_type, headers=resp_headers)


# ---------- cover proxy (同源代理封面，供前端 WebGL 取色，避免跨域污染 canvas) ----------
@app.get("/api/cover")
def cover(url: str = Query(..., min_length=8)) -> StreamingResponse:
    # SSRF 防护：url 完全来自客户端，须校验主机为公网地址；并禁用重定向，
    # 防止「公网地址 302 跳内网」绕过（封面 CDN 都是直链，禁跳转不影响正常使用）。
    if not _is_safe_public_url(url):
        raise HTTPException(400, "invalid or disallowed cover url")
    try:
        req = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, stream=True, timeout=(8, 30), allow_redirects=False)
        if req.status_code in (301, 302, 303, 307, 308):
            req.close()
            raise HTTPException(400, "cover url redirect not allowed")
        req.raise_for_status()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "failed to fetch cover")
    media_type = req.headers.get("Content-Type", "image/jpeg")
    if not media_type.startswith("image/"):
        media_type = "image/jpeg"

    def gen():
        try:
            for chunk in req.iter_content(chunk_size=1024 * 64):
                if chunk:
                    yield chunk
        finally:
            with suppress(Exception):
                req.close()

    return StreamingResponse(gen(), media_type=media_type, headers={"Cache-Control": "public, max-age=86400"})


# ---------- download (直接浏览器下载) ----------
def _safe_filename(name: str) -> str:
    bad = '\\/:*?"<>|\n\r\t'
    cleaned = "".join("_" if c in bad else c for c in (name or "")).strip()
    return cleaned or "audio"


def _ascii_fallback(name: str) -> str:
    return "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in name) or "audio"


@app.get("/api/download/{song_id}")
def download_file(song_id: str):
    """把上游音频以附件形式代理回浏览器，点击即触发浏览器原生下载。"""
    info = _resolve_for_playback(song_id)
    if info is None:
        raise HTTPException(404, "song not found")
    if not _is_http(info.download_url):
        raise HTTPException(400, "this source is not directly downloadable in browser")

    # 直链过期会被上游 CDN 拒（4xx），_open_upstream 会强制重解并重试一次
    upstream, info = _open_upstream(song_id, info)
    if upstream.status_code >= 400:
        with suppress(Exception):
            upstream.close()
        raise HTTPException(502, "upstream link expired, retry later")

    ext = (info.ext or "mp3").lstrip(".")
    base = " - ".join([p for p in (info.song_name, info.singers) if p]) or "audio"
    filename = f"{_safe_filename(base)}.{ext}"
    disposition = f"attachment; filename=\"{_ascii_fallback(filename)}\"; filename*=UTF-8''{quote(filename)}"

    def iter_chunks():
        try:
            for chunk in upstream.iter_content(chunk_size=1024 * 256):
                if chunk:
                    yield chunk
        except (requests.exceptions.ChunkedEncodingError, requests.exceptions.ConnectionError):
            pass
        finally:
            with suppress(Exception):
                upstream.close()

    resp_headers = {"Content-Disposition": disposition}
    if upstream.headers.get("Content-Length"):
        resp_headers["Content-Length"] = upstream.headers["Content-Length"]
    return StreamingResponse(iter_chunks(), media_type="application/octet-stream", headers=resp_headers)


# ---------- SPA fallback ----------
@app.get("/")
def index() -> FileResponse:
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return FileResponse(idx)
    return FileResponse(BASE_DIR / "placeholder.html")


@app.get("/{path:path}")
def spa(path: str) -> FileResponse:
    # API 路径不应走到这里
    if path.startswith("api/"):
        raise HTTPException(404, "not found")
    candidate = STATIC_DIR / path
    if candidate.is_file():
        return FileResponse(candidate)
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return FileResponse(idx)
    raise HTTPException(404, "not found")


def main() -> None:
    import uvicorn
    # 默认只监听本机，避免裸跑时无意暴露到局域网/公网；需对外可设 MUSICDL_HOST=0.0.0.0。
    # （Docker 镜像的 CMD 显式传 --host 0.0.0.0，不走这里，容器对外由端口映射控制。）
    host = os.environ.get("MUSICDL_HOST", "127.0.0.1")
    port = int(os.environ.get("MUSICDL_PORT", "8000"))
    uvicorn.run("web.backend:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
