export interface SongInfo {
  id: string
  source: string | null
  root_source: string | null
  song_name: string | null
  singers: string | null
  album: string | null
  album_id: string | null
  ext: string | null
  file_size: string | null
  duration: string | null
  duration_s: number | null
  cover_url: string | null
  lyric: string | null
  protocol: string | null
  playable: boolean
  quality_tier: QualityTier | null
  quality_label: string | null
  quality_detail: string | null
}

export type QualityTier = 'atmos' | 'hires' | 'lossless' | 'high' | 'standard'

export interface SearchResponse {
  keyword: string
  total: number
  songs: SongInfo[]
}

export interface PlaylistResponse {
  total: number
  songs: SongInfo[]
}

export interface AlbumInfo {
  album_id: string
  album_name: string | null
  singers: string | null
  cover_url: string | null
  song_count: number
  publish_time: string | null
  source: string | null
}

export interface AlbumSearchResponse {
  keyword: string
  total: number
  albums: AlbumInfo[]
}

export interface PlaylistSummary {
  id: string
  name: string
  created_at: number | null
  updated_at: number | null
  song_count: number
  covers: string[]
}

export interface PlaylistDetail extends PlaylistSummary {
  songs: SongInfo[]
}

export interface HotPlaylist {
  id: string
  name: string
  cover_url: string
  play_count: number
  song_count: number
  creator: string
  url: string
  source: string
}

export interface HotPlaylistResponse {
  source: string
  total: number
  playlists: HotPlaylist[]
}
