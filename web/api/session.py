from __future__ import annotations

import threading
import time
from typing import Any

from musicdl.musicdl import MusicClient
from musicdl.modules import SongInfo

from .quality import quality_tier


DEFAULT_SOURCES = ["NeteaseMusicClient", "QQMusicClient", "KuwoMusicClient"]

# 专辑搜索支持的源（均实现 searchalbum/parsealbum），按此顺序聚合
ALBUM_SOURCES = ["NeteaseMusicClient", "QQMusicClient"]

# 检索提速核心：把每个源的检索拆成更小的分页（search_size_per_page），
# 每个分页在独立线程里解析下载直链/校验/取歌词，从而把原本「单页内逐首串行」
# 变成「多页并行」。配合每个源 num_threadings 提升，整体检索延迟约从 N 首串行
# 降到 1~2 首串行的耗时。
SEARCH_SIZE_PER_SOURCE = 6          # 每个源返回的目标条数（8→6：凑满末尾几首会触发疯狂重试，6 几乎砍半耗时）
SEARCH_SIZE_PER_PAGE = 2            # 每个分页（线程）解析的条数，越小越并行
SOURCE_THREADINGS = 8              # 每个源内部用于并行各分页的线程数
SEARCH_CACHE_TTL = 300.0           # 关键词检索结果缓存秒数（同词重复检索秒回）
SEARCH_SOURCE_TIMEOUT = 8.0        # 单个源检索超时秒数（超时则跳过该源，避免个别慢源拖死整体）


def _song_id(source: str, identifier: Any) -> str:
    return f"{source}:{identifier}"


def _is_http_url(url: Any) -> bool:
    return isinstance(url, str) and url.startswith("http")


def _album_id_of(info: SongInfo) -> str | None:
    """从歌曲原始数据里抽出所属专辑 id（仅网易/QQ 可解析专辑，其余源返回 None）。"""
    search = (info.raw_data or {}).get("search") or {}
    if not isinstance(search, dict):
        return None
    if info.source == "NeteaseMusicClient":
        aid = (search.get("al") or {}).get("id")
        return str(aid) if aid else None
    if info.source == "QQMusicClient":
        aid = (search.get("album") or {}).get("mid") or search.get("albummid")
        return str(aid) if aid else None
    return None


class SessionManager:
    def __init__(self, music_sources: list[str] | None = None) -> None:
        self.sources = list(music_sources or DEFAULT_SOURCES)
        per_source_cfg = {
            "search_size_per_source": SEARCH_SIZE_PER_SOURCE,
            "search_size_per_page": SEARCH_SIZE_PER_PAGE,
        }
        self.client = MusicClient(
            music_sources=self.sources,
            init_music_clients_cfg={s: dict(per_source_cfg) for s in self.sources},
            clients_threadings={s: SOURCE_THREADINGS for s in self.sources},
        )
        # 缓存: song_id -> SongInfo
        self._cache: dict[str, SongInfo] = {}
        self._cache_lock = threading.Lock()
        self._search_lock = threading.Lock()
        # 关键词检索结果缓存: (source, keyword) -> (timestamp, list[dict])
        self._result_cache: dict[tuple[str, str, int], tuple[float, list[dict]]] = {}
        self._result_cache_lock = threading.Lock()

    # ---- sources ----
    def available_sources(self) -> list[str]:
        from musicdl.modules import MusicClientBuilder
        return sorted(MusicClientBuilder.REGISTERED_MODULES.keys())

    def enabled_sources(self) -> list[str]:
        return list(self.sources)

    # ---- search ----
    def search(self, keyword: str) -> list[dict]:
        with self._search_lock:
            raw = self.client.search(keyword=keyword)
        out: list[dict] = []
        for source, infos in raw.items():
            for info in infos:
                if not isinstance(info, SongInfo) or not info.with_valid_download_url:
                    continue
                sid = _song_id(source, info.identifier)
                with self._cache_lock:
                    self._cache[sid] = info
                out.append(self._to_json(sid, info))
        return out

    def search_source(self, source: str, keyword: str, page: int = 1) -> list[dict]:
        """单源搜索，用于流式搜索接口；快源先返回。命中缓存则秒回。

        page>1 时取该源的后续整页结果，实现「触底加载更多」。
        """
        client = self.client.music_clients.get(source)
        if client is None:
            return []
        key = (source, keyword.strip().lower(), page)
        now = time.time()
        with self._result_cache_lock:
            hit = self._result_cache.get(key)
            if hit is not None and now - hit[0] < SEARCH_CACHE_TTL:
                return hit[1]
        try:
            infos = client.search(keyword=keyword, num_threadings=SOURCE_THREADINGS, page=page)
        except Exception:
            return []
        out: list[dict] = []
        for info in infos:
            if not isinstance(info, SongInfo) or not info.with_valid_download_url:
                continue
            sid = _song_id(source, info.identifier)
            with self._cache_lock:
                self._cache[sid] = info
            out.append(self._to_json(sid, info))
        with self._result_cache_lock:
            self._result_cache[key] = (now, out)
        return out

    # ---- album ----
    def _search_album_one(self, source: str, keyword: str) -> list[dict]:
        client = self.client.music_clients.get(source)
        if client is None or not hasattr(client, "searchalbum"):
            return []
        try:
            return client.searchalbum(keyword=keyword) or []
        except Exception:
            return []

    def search_album(self, keyword: str) -> list[dict]:
        """按专辑名跨源检索（网易云 + QQ），各源并发，合并返回；前端按 source 分 tab。"""
        from concurrent.futures import ThreadPoolExecutor

        results: dict[str, list[dict]] = {}
        with ThreadPoolExecutor(max_workers=len(ALBUM_SOURCES)) as pool:
            futures = {pool.submit(self._search_album_one, s, keyword): s for s in ALBUM_SOURCES}
            for fut, src in futures.items():
                try:
                    results[src] = fut.result()
                except Exception:
                    results[src] = []
        # 按 ALBUM_SOURCES 顺序拼接，保证网易在前
        return [a for s in ALBUM_SOURCES for a in results.get(s, [])]

    def _album_client(self, source: str | None):
        """按 source 返回具备专辑能力的客户端；source 缺省时按 ALBUM_SOURCES 依次找。"""
        candidates = [source] if source else list(ALBUM_SOURCES)
        return next(
            (c for s in candidates if (c := self.client.music_clients.get(s)) is not None and hasattr(c, "parsealbum")),
            None,
        )

    def album_tracks_meta(self, album_id: str, source: str | None = None) -> tuple[list, str]:
        """取专辑原始曲目列表（未解析直链）+ 专辑名，供流式逐首解析。"""
        client = self._album_client(source)
        if client is None or not hasattr(client, "getalbumtracks"):
            return [], ""
        try:
            tracks, name = client.getalbumtracks(album_id=album_id)
            return list(tracks or []), name or ""
        except Exception:
            return [], ""

    def resolve_album_track(self, source: str | None, track_info: dict) -> dict | None:
        """解析专辑内单首曲目直链，命中则缓存 SongInfo 并返回 JSON；失败/无直链返回 None。"""
        client = self._album_client(source)
        if client is None or not hasattr(client, "resolvealbumtrack"):
            return None
        try:
            info = client.resolvealbumtrack(track_info)
        except Exception:
            return None
        if not isinstance(info, SongInfo) or not info.with_valid_download_url:
            return None
        sid = _song_id(info.source, info.identifier)
        with self._cache_lock:
            self._cache[sid] = info
        return self._to_json(sid, info)

    def parse_album(self, album_id: str, source: str | None = None) -> list[dict]:
        """解析整张专辑曲目，缓存每首 SongInfo 供播放/下载，返回 JSON 列表。

        source 指定专辑所属源（网易/QQ 的 album_id 不通用，必须按源路由）。
        """
        client = self._album_client(source)
        if client is None:
            return []
        try:
            infos = client.parsealbum(album_id=album_id)
        except Exception:
            return []
        out: list[dict] = []
        for info in infos:
            if not isinstance(info, SongInfo) or not info.with_valid_download_url:
                continue
            sid = _song_id(info.source, info.identifier)
            with self._cache_lock:
                self._cache[sid] = info
            out.append(self._to_json(sid, info))
        return out

    def search_playlist(self, url: str) -> list[dict]:
        infos = self.client.parseplaylist(playlist_url=url)
        out: list[dict] = []
        for info in infos:
            if not isinstance(info, SongInfo) or not info.with_valid_download_url:
                continue
            sid = _song_id(info.source, info.identifier)
            with self._cache_lock:
                self._cache[sid] = info
            out.append(self._to_json(sid, info))
        return out

    # ---- access cached song ----
    def get_song(self, song_id: str) -> SongInfo | None:
        with self._cache_lock:
            return self._cache.get(song_id)

    def reresolve(self, song_id: str, name: str | None, singers: str | None) -> SongInfo | None:
        """为「歌单里收藏的歌」重新解析一条有效直链。

        各源的下载直链是临时 CDN 链接，会过期；服务端内存缓存也会随重启丢失。
        收藏播放时若缓存里没有有效直链，就按 source 用歌名重新检索一遍，
        优先精确匹配同一 identifier，其次回退到「同名同歌手」的结果，
        命中后缓存到原 song_id 下，使后续 /stream、/download、/lyric 照常按 id 工作。
        """
        cached = self.get_song(song_id)
        if cached is not None and _is_http_url(cached.download_url):
            return cached
        source, _sep, _identifier = song_id.partition(":")
        client = self.client.music_clients.get(source)
        if client is None or not name:
            return cached
        try:
            infos = client.search(keyword=name, num_threadings=SOURCE_THREADINGS)
        except Exception:
            return cached
        valid = [i for i in infos if isinstance(i, SongInfo) and i.with_valid_download_url]
        match = next((i for i in valid if _song_id(i.source, i.identifier) == song_id), None)
        if match is None and singers:
            match = next(
                (i for i in valid if (i.song_name or "") == name and (i.singers or "") == singers),
                None,
            )
        if match is None:
            return cached
        with self._cache_lock:
            self._cache[song_id] = match
            self._cache[_song_id(match.source, match.identifier)] = match
        return match

    def download_io(self, info: SongInfo) -> tuple[dict, dict]:
        """播放/下载代理用的有效 headers/cookies。

        SongInfo 自带的 default_download_headers 常为空（如酷我），导致直链 CDN
        因缺少 User-Agent 等返回 403；此处用对应源客户端的下载默认头作为兜底，
        再用 SongInfo 自身的非空字段覆盖。
        """
        client = self.client.music_clients.get(info.source)
        headers = dict((getattr(client, "default_download_headers", None) or {}))
        headers.update(dict(info.default_download_headers or {}))
        cookies = dict((getattr(client, "default_download_cookies", None) or {}))
        cookies.update(dict(info.default_download_cookies or {}))
        return headers, cookies

    # ---- serialize ----
    def _to_json(self, sid: str, info: SongInfo) -> dict:
        playable = _is_http_url(info.download_url)
        tier = quality_tier(info)
        return {
            "id": sid,
            "source": info.source,
            "root_source": info.root_source,
            "song_name": info.song_name,
            "singers": info.singers,
            "album": info.album,
            "album_id": _album_id_of(info),
            "ext": info.ext,
            "file_size": info.file_size,
            "duration": info.duration,
            "duration_s": info.duration_s,
            "cover_url": info.cover_url,
            "lyric": info.lyric,
            "protocol": info.protocol,
            "playable": playable,
            "quality_tier": tier["tier"],
            "quality_label": tier["label"],
            "quality_detail": tier["detail"],
        }


session = SessionManager()
