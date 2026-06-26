import { memo } from 'react'
import { Play, Download, Trash2 } from 'lucide-react'
import type { SongInfo } from '../types'
import { usePlayer } from '../player-context'
import { triggerBrowserDownload } from '../api'
import { SourceBadge } from './SourceBadge'
import { QualityBadge } from './QualityBadge'
import { AddToPlaylist } from './AddToPlaylist'

interface Props {
  songs: SongInfo[]
  onAlbumClick?: (song: SongInfo) => void
  /** 提供时，行尾显示「移出歌单」按钮（歌单详情用）；否则显示「加入歌单」按钮。 */
  onRemove?: (song: SongInfo) => void
}

function fmtIndex(i: number): string {
  return String(i + 1).padStart(2, '0')
}

/** 正在播放指示器：跳动的均衡器条（播放时动画，暂停时静止） */
function NowPlayingBars({ animated }: { animated: boolean }) {
  return (
    <span className={`np-bars${animated ? ' on' : ''}`} aria-label="正在播放">
      <span />
      <span />
      <span />
      <span />
    </span>
  )
}

function SongRowImpl({
  song,
  index,
  active,
  playing,
  onPlay,
  onAlbumClick,
  onRemove,
}: {
  song: SongInfo
  index: number
  active: boolean
  playing: boolean
  onPlay: () => void
  onAlbumClick?: (song: SongInfo) => void
  onRemove?: (song: SongInfo) => void
}) {
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    triggerBrowserDownload(song.id)
  }
  const albumClickable = !!(song.album_id && song.album && onAlbumClick)

  return (
    <tr
      className={active ? 'active' : ''}
      onClick={onPlay}
      title={song.playable ? '点击播放' : '该源不支持浏览器播放/下载'}
    >
      <td className="col-idx">
        <span className="idx-num">
          {active ? <NowPlayingBars animated={playing} /> : fmtIndex(index)}
        </span>
        <button
          className="idx-play"
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
          disabled={!song.playable}
          aria-label="播放"
        >
          <Play size={14} fill="currentColor" />
        </button>
      </td>
      <td className="col-name">
        <div className="cell-title">
          <span className="cell-title-text">{song.song_name}</span>
          <QualityBadge tier={song.quality_tier} label={song.quality_label} detail={song.quality_detail} />
        </div>
        <div className="cell-sub">{song.singers}</div>
      </td>
      <td className="col-album">
        {albumClickable ? (
          <button
            className="album-link"
            onClick={(e) => {
              e.stopPropagation()
              onAlbumClick!(song)
            }}
            title={`查看专辑：${song.album}`}
          >
            {song.album}
          </button>
        ) : (
          song.album || '—'
        )}
      </td>
      <td className="col-src">
        <SourceBadge source={song.source} />
      </td>
      <td className="col-size">{song.file_size || '—'}</td>
      <td className="col-time">{song.duration || '—'}</td>
      <td className="col-act">
        <div className="row-actions">
          {onRemove ? (
            <button
              className="dl-btn remove-btn"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(song)
              }}
              title="移出歌单"
              aria-label="移出歌单"
            >
              <Trash2 size={16} />
            </button>
          ) : (
            <AddToPlaylist song={song} />
          )}
          <button
            className="dl-btn"
            onClick={handleDownload}
            disabled={!song.playable}
            title={song.playable ? '下载到本地' : '该源不支持浏览器下载'}
            aria-label="下载"
          >
            <Download size={16} />
          </button>
        </div>
      </td>
    </tr>
  )
}

const SongRow = memo(SongRowImpl)

export function SongTable({ songs, onAlbumClick, onRemove }: Props) {
  const { playSong, queue, current, playing } = usePlayer()
  const activeId = queue[current]?.id

  return (
    <div className="table-wrap">
      <table className="songs">
        <thead>
          <tr>
            <th className="col-idx">#</th>
            <th className="col-name">标题</th>
            <th className="col-album">专辑</th>
            <th className="col-src">来源</th>
            <th className="col-size">大小</th>
            <th className="col-time">⏱</th>
            <th className="col-act"></th>
          </tr>
        </thead>
        <tbody>
          {songs.map((s, i) => (
            <SongRow
              key={s.id + i}
              song={s}
              index={i}
              active={s.id === activeId}
              playing={playing}
              onPlay={() => playSong(s, songs)}
              onAlbumClick={onAlbumClick}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
