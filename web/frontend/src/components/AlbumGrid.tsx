import { Disc3, Play } from 'lucide-react'
import type { AlbumInfo } from '../types'

interface Props {
  albums: AlbumInfo[]
  onSelect: (album: AlbumInfo) => void
}

/** 专辑卡片网格：点击某张专辑进入其详情页（二级页面）。 */
export function AlbumGrid({ albums, onSelect }: Props) {
  return (
    <div className="album-grid">
      {albums.map((a) => (
        <button
          key={`${a.source}:${a.album_id}`}
          className="album-card"
          onClick={() => onSelect(a)}
          title={`${a.album_name || ''} - ${a.singers || ''}`}
        >
          <div className="album-cover">
            {a.cover_url ? (
              <img src={a.cover_url} alt={a.album_name || ''} loading="lazy" />
            ) : (
              <Disc3 size={28} className="opacity-50" />
            )}
            <span className="album-cover-badge">
              <Play size={16} fill="currentColor" />
            </span>
          </div>
          <div className="album-meta">
            <div className="album-name">{a.album_name || '未知专辑'}</div>
            <div className="album-sub">
              {a.singers || '未知歌手'}
              {a.song_count ? ` · ${a.song_count} 首` : ''}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
