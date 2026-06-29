import type {
  AlbumSearchResponse,
  HotPlaylistResponse,
  PlaylistDetail,
  PlaylistResponse,
  PlaylistSummary,
  SearchResponse,
  SongInfo,
} from './types'

const base = import.meta.env.BASE_URL || '/'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`)
  return res.json() as Promise<T>
}

export async function search(keyword: string): Promise<SearchResponse> {
  return json(await fetch(`${base}api/search?keyword=${encodeURIComponent(keyword)}`))
}

export interface SearchBatch {
  source: string
  done: number
  total_sources: number
  songs: SongInfo[]
}

export function subscribeSearch(
  keyword: string,
  onBatch: (batch: SearchBatch) => void,
  onDone: () => void,
  page = 1,
): () => void {
  const es = new EventSource(
    `${base}api/search/stream?keyword=${encodeURIComponent(keyword)}&page=${page}`,
  )
  es.addEventListener('batch', (e) => onBatch(JSON.parse((e as MessageEvent).data)))
  es.addEventListener('done', () => {
    onDone()
    es.close()
  })
  es.onerror = () => es.close()
  return () => es.close()
}

/** 按专辑名检索，返回专辑卡片列表（QQ 源）。signal 用于打断上一次未完成的检索。 */
export async function searchAlbum(keyword: string, signal?: AbortSignal): Promise<AlbumSearchResponse> {
  return json(await fetch(`${base}api/search/album?keyword=${encodeURIComponent(keyword)}`, { signal }))
}

/** 解析整张专辑曲目（点击专辑卡片后展开用）。source 用于按源路由（网易/QQ 的 id 不通用）。 */
export async function parseAlbum(albumId: string, source?: string | null): Promise<PlaylistResponse> {
  return json(
    await fetch(`${base}api/album`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album_id: albumId, source: source ?? null }),
    }),
  )
}

export interface AlbumTrackBatch {
  done: number
  total: number
  index: number
  song: SongInfo | null
}

/** 流式解析专辑：解一首推一首。返回 close 句柄用于中途取消。 */
export function subscribeAlbum(
  albumId: string,
  source: string | null | undefined,
  onMeta: (total: number) => void,
  onTrack: (batch: AlbumTrackBatch) => void,
  onDone: () => void,
): () => void {
  const qs = `album_id=${encodeURIComponent(albumId)}${source ? `&source=${encodeURIComponent(source)}` : ''}`
  const es = new EventSource(`${base}api/album/stream?${qs}`)
  es.addEventListener('meta', (e) => onMeta(JSON.parse((e as MessageEvent).data).total))
  es.addEventListener('track', (e) => onTrack(JSON.parse((e as MessageEvent).data)))
  es.addEventListener('done', () => {
    onDone()
    es.close()
  })
  es.onerror = () => {
    onDone()
    es.close()
  }
  return () => es.close()
}

/** 拉取热门/推荐歌单卡片（网易云精品歌单 / QQ 歌单广场最热）。 */
export async function getHotPlaylists(source: string): Promise<HotPlaylistResponse> {
  return json(await fetch(`${base}api/hotplaylists?source=${encodeURIComponent(source)}`))
}

/** 流式解析歌单（外部链接 / 热门歌单）：解一首推一首，返回 close 句柄用于中途取消。 */
export function subscribePlaylist(
  url: string,
  source: string | null | undefined,
  onMeta: (total: number) => void,
  onTrack: (batch: AlbumTrackBatch) => void,
  onDone: () => void,
): () => void {
  const qs = `url=${encodeURIComponent(url)}${source ? `&source=${encodeURIComponent(source)}` : ''}`
  const es = new EventSource(`${base}api/playlist/stream?${qs}`)
  es.addEventListener('meta', (e) => onMeta(JSON.parse((e as MessageEvent).data).total))
  es.addEventListener('track', (e) => onTrack(JSON.parse((e as MessageEvent).data)))
  es.addEventListener('done', () => {
    onDone()
    es.close()
  })
  es.onerror = () => {
    onDone()
    es.close()
  }
  return () => es.close()
}

export async function parsePlaylist(url: string): Promise<PlaylistResponse> {
  return json(
    await fetch(`${base}api/playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  )
}

// ---------- 个人收藏歌单 ----------
export async function listPlaylists(): Promise<PlaylistSummary[]> {
  const data = await json<{ playlists: PlaylistSummary[] }>(await fetch(`${base}api/playlists`))
  return data.playlists
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  return json(await fetch(`${base}api/playlists/${encodeURIComponent(id)}`))
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  return json(
    await fetch(`${base}api/playlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  )
}

export async function renamePlaylist(id: string, name: string): Promise<PlaylistSummary> {
  return json(
    await fetch(`${base}api/playlists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  )
}

export async function deletePlaylist(id: string): Promise<void> {
  const res = await fetch(`${base}api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${res.status}`)
}

export async function addSongToPlaylist(id: string, song: SongInfo): Promise<PlaylistDetail> {
  return json(
    await fetch(`${base}api/playlists/${encodeURIComponent(id)}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song }),
    }),
  )
}

export async function removeSongFromPlaylist(id: string, songId: string): Promise<PlaylistDetail> {
  return json(
    await fetch(
      `${base}api/playlists/${encodeURIComponent(id)}/songs/${encodeURIComponent(songId)}`,
      { method: 'DELETE' },
    ),
  )
}

export async function fetchLyric(songId: string): Promise<string> {
  const res = await fetch(`${base}api/lyric/${encodeURIComponent(songId)}`)
  if (!res.ok) return ''
  const data = (await res.json()) as { lyric: string }
  return data.lyric || ''
}

export function coverProxy(url: string): string {
  return `${base}api/cover?url=${encodeURIComponent(url)}`
}

export function streamUrl(songId: string): string {
  return `${base}api/stream/${encodeURIComponent(songId)}`
}

/** 直链下载地址：后端以 attachment 形式代理音频，浏览器原生触发下载。 */
export function downloadUrl(songId: string): string {
  return `${base}api/download/${encodeURIComponent(songId)}`
}

/** 触发浏览器原生下载（无需经过服务端落盘）。 */
export function triggerBrowserDownload(songId: string): void {
  const a = document.createElement('a')
  a.href = downloadUrl(songId)
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
