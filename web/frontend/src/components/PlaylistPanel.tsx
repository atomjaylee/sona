import { X } from 'lucide-react'
import { usePlayer } from '../player-context'
import { sourceLabel } from '../source-label'

export function PlaylistPanel() {
  const { queue, current, playSong, removeFromQueue } = usePlayer()

  if (queue.length === 0) {
    return <div className="empty">播放队列为空，点击歌曲开始播放</div>
  }

  return (
    <div className="queue">
      {queue.map((s, i) => (
        <div key={s.id + i} className={`queue-item ${i === current ? 'active' : ''}`}>
          <div className="qmeta" onClick={() => playSong(s, queue)} style={{ cursor: 'pointer' }}>
            <div className="qtitle">{s.song_name}</div>
            <div className="qsub">{s.singers} · {sourceLabel(s.source)}</div>
          </div>
          <button className="queue-remove" onClick={() => removeFromQueue(i)} aria-label="移除"><X size={16} /></button>
        </div>
      ))}
    </div>
  )
}
