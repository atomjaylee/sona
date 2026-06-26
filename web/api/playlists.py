from __future__ import annotations

import json
import os
import threading
import time
import uuid
from contextlib import suppress
from pathlib import Path
from typing import Any

# 持久化目录：默认放在 web/musicdl_outputs（docker-compose 已把该目录挂载为宿主机卷，
# 容器重启不丢）。可用环境变量 MUSICDL_DATA_DIR 覆盖。
_BASE_DIR = Path(__file__).resolve().parent.parent  # -> web/
_DATA_DIR = Path(os.environ.get("MUSICDL_DATA_DIR") or (_BASE_DIR / "musicdl_outputs"))
_STORE_FILE = _DATA_DIR / "playlists.json"

# 歌单封面预览最多取前几首歌的封面拼图
_COVER_PREVIEW = 4


def _now() -> int:
    return int(time.time())


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class PlaylistStore:
    """歌单持久化存储：单个 JSON 文件 + 进程内读写锁 + 原子落盘。

    结构::

        {"playlists": [
            {"id", "name", "created_at", "updated_at",
             "songs": [ <SongInfoOut dict>, ... ]}
        ]}

    每首歌存完整的序列化 SongInfo（即 session._to_json 的输出），既能直接展示，
    也保留了 id/歌名/歌手，供播放时按源重新解析过期直链（见 session.reresolve）。
    """

    def __init__(self, path: Path = _STORE_FILE) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._data: dict[str, Any] = {"playlists": []}
        self._load()

    # ---- 持久化 ----
    def _load(self) -> None:
        with self._lock:
            try:
                raw = json.loads(self._path.read_text(encoding="utf-8"))
                if isinstance(raw, dict) and isinstance(raw.get("playlists"), list):
                    self._data = raw
            except FileNotFoundError:
                pass
            except Exception:
                # 文件损坏：备份后从空开始，避免整个功能挂掉
                with suppress(Exception):
                    self._path.rename(self._path.with_suffix(".corrupt"))
                self._data = {"playlists": []}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)  # 原子替换，避免写到一半被读到

    # ---- 内部查找 ----
    def _find(self, playlist_id: str) -> dict | None:
        return next((p for p in self._data["playlists"] if p["id"] == playlist_id), None)

    @staticmethod
    def _summary(p: dict) -> dict:
        songs = p.get("songs") or []
        covers = [s.get("cover_url") for s in songs if s.get("cover_url")][:_COVER_PREVIEW]
        return {
            "id": p["id"],
            "name": p["name"],
            "created_at": p.get("created_at"),
            "updated_at": p.get("updated_at"),
            "song_count": len(songs),
            "covers": covers,
        }

    # ---- 公开 API ----
    def list_summaries(self) -> list[dict]:
        with self._lock:
            return [self._summary(p) for p in self._data["playlists"]]

    def get(self, playlist_id: str) -> dict | None:
        with self._lock:
            p = self._find(playlist_id)
            if p is None:
                return None
            return {**self._summary(p), "songs": list(p.get("songs") or [])}

    def create(self, name: str) -> dict:
        name = (name or "").strip() or "新歌单"
        with self._lock:
            p = {"id": _new_id("pl"), "name": name, "created_at": _now(), "updated_at": _now(), "songs": []}
            self._data["playlists"].append(p)
            self._save()
            return self._summary(p)

    def rename(self, playlist_id: str, name: str) -> dict | None:
        name = (name or "").strip()
        with self._lock:
            p = self._find(playlist_id)
            if p is None:
                return None
            if name:
                p["name"] = name
                p["updated_at"] = _now()
                self._save()
            return self._summary(p)

    def delete(self, playlist_id: str) -> bool:
        with self._lock:
            before = len(self._data["playlists"])
            self._data["playlists"] = [p for p in self._data["playlists"] if p["id"] != playlist_id]
            changed = len(self._data["playlists"]) != before
            if changed:
                self._save()
            return changed

    def add_song(self, playlist_id: str, song: dict) -> dict | None:
        """把一首歌加入歌单；按 song id 去重（已存在则原样返回，不重复加）。"""
        sid = song.get("id")
        if not sid:
            return None
        with self._lock:
            p = self._find(playlist_id)
            if p is None:
                return None
            songs = p.setdefault("songs", [])
            if not any(s.get("id") == sid for s in songs):
                songs.append(song)
                p["updated_at"] = _now()
                self._save()
            return {**self._summary(p), "songs": list(songs)}

    def remove_song(self, playlist_id: str, song_id: str) -> dict | None:
        with self._lock:
            p = self._find(playlist_id)
            if p is None:
                return None
            songs = p.get("songs") or []
            kept = [s for s in songs if s.get("id") != song_id]
            if len(kept) != len(songs):
                p["songs"] = kept
                p["updated_at"] = _now()
                self._save()
            return {**self._summary(p), "songs": list(p.get("songs") or [])}

    def find_song(self, song_id: str) -> dict | None:
        """跨所有歌单按 id 查一首歌的元数据（供播放时重解析过期直链取歌名/歌手）。"""
        with self._lock:
            for p in self._data["playlists"]:
                for s in p.get("songs") or []:
                    if s.get("id") == song_id:
                        return s
        return None


store = PlaylistStore()
