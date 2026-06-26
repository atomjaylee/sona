from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class SongInfoOut(BaseModel):
    id: str = Field(..., description="唯一标识 source:identifier")
    source: Optional[str] = None
    root_source: Optional[str] = None
    song_name: Optional[str] = None
    singers: Optional[str] = None
    album: Optional[str] = None
    album_id: Optional[str] = None
    ext: Optional[str] = None
    file_size: Optional[str] = None
    duration: Optional[str] = None
    duration_s: Optional[float] = None
    cover_url: Optional[str] = None
    lyric: Optional[str] = None
    protocol: Optional[str] = None
    playable: bool = False
    quality_tier: Optional[str] = None
    quality_label: Optional[str] = None
    quality_detail: Optional[str] = None


class SearchResponse(BaseModel):
    keyword: str
    total: int
    songs: list[SongInfoOut]


class AlbumInfoOut(BaseModel):
    album_id: str = Field(..., description="专辑唯一标识（QQ albummid）")
    album_name: Optional[str] = None
    singers: Optional[str] = None
    cover_url: Optional[str] = None
    song_count: int = 0
    publish_time: Optional[str] = None
    source: Optional[str] = None


class AlbumSearchResponse(BaseModel):
    keyword: str
    total: int
    albums: list[AlbumInfoOut]


class AlbumRequest(BaseModel):
    album_id: str
    source: Optional[str] = None


class PlaylistRequest(BaseModel):
    url: str


class PlaylistResponse(BaseModel):
    total: int
    songs: list[SongInfoOut]


class SourceInfo(BaseModel):
    name: str
    enabled: bool


# ---------- 歌单（收藏） ----------
class PlaylistSummary(BaseModel):
    id: str
    name: str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    song_count: int = 0
    covers: list[str] = Field(default_factory=list)


class PlaylistDetail(PlaylistSummary):
    songs: list[SongInfoOut] = Field(default_factory=list)


class PlaylistListResponse(BaseModel):
    playlists: list[PlaylistSummary]


class PlaylistCreateRequest(BaseModel):
    name: str


class PlaylistRenameRequest(BaseModel):
    name: str


class PlaylistAddSongRequest(BaseModel):
    song: SongInfoOut
