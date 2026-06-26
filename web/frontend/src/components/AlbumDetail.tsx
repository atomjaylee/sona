import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Disc3, Loader2 } from 'lucide-react'
import { subscribeAlbum } from '../api'
import type { AlbumInfo, SongInfo } from '../types'
import { SongTable } from './SongTable'

interface Props {
  album: AlbumInfo
  onBack: () => void
}

/** 专辑详情（二级页面）：流式解析整张曲目，解一首出现一首（按原始顺序插入）。 */
export function AlbumDetail({ album, onBack }: Props) {
  const [tracks, setTracks] = useState<SongInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const byIndexRef = useRef<Map<number, SongInfo>>(new Map())

  useEffect(() => {
    setLoading(true)
    setError('')
    setTracks([])
    setProgress({ done: 0, total: 0 })
    byIndexRef.current = new Map()

    const close = subscribeAlbum(
      album.album_id,
      album.source,
      (total) => setProgress((p) => ({ ...p, total })),
      ({ done, total, index, song }) => {
        setProgress({ done, total })
        if (!song) return
        // 按专辑原始顺序插入：解出的曲目即时出现，且保持顺序
        byIndexRef.current.set(index, song)
        const ordered = [...byIndexRef.current.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s)
        setTracks(ordered)
      },
      () => {
        setLoading(false)
        if (byIndexRef.current.size === 0) setError('该专辑暂无可下载曲目')
      },
    )
    return () => close()
  }, [album.album_id, album.source])

  const meta = [album.singers || '未知歌手']
  if (album.song_count) meta.push(`${album.song_count} 首`)
  if (album.publish_time) meta.push(album.publish_time)

  return (
    <div className="album-detail">
      <button className="back-btn" onClick={onBack}>
        <ArrowLeft size={18} /> 返回专辑结果
      </button>

      <header className="album-detail-head">
        <div className="album-detail-cover">
          {album.cover_url ? (
            <img src={album.cover_url} alt={album.album_name || ''} />
          ) : (
            <Disc3 size={48} className="opacity-50" />
          )}
        </div>
        <div className="album-detail-info">
          <span className="album-detail-kind">专辑</span>
          <h2 className="album-detail-title">{album.album_name || '未知专辑'}</h2>
          <div className="album-detail-sub">{meta.join(' · ')}</div>
        </div>
      </header>

      {/* 解析中且已有曲目：顶部显示进度，下方曲目实时追加（解一首出现一首） */}
      {loading && tracks.length > 0 ? (
        <div className="album-parsing">
          <Loader2 size={14} className="animate-spin" />
          正在解析曲目 {progress.done}/{progress.total || '…'}
        </div>
      ) : null}

      {tracks.length > 0 ? (
        <SongTable songs={tracks} />
      ) : loading ? (
        <div className="empty">
          <Loader2 size={24} className="mx-auto mb-3 animate-spin opacity-70" />
          正在解析专辑曲目 {progress.total ? `${progress.done}/${progress.total}` : '…'}
        </div>
      ) : error ? (
        <div className="notice err">{error}</div>
      ) : null}
    </div>
  )
}
