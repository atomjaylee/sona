import { useEffect, useRef, useState } from 'react'
import { SkipBack, SkipForward, Play, Pause, MessageSquareQuote, Music2 } from 'lucide-react'
import { usePlayer } from '../player-context'
import { parseLrc } from '../lrc'
import { QualityBadge } from './QualityBadge'

export function Player() {
  const { audioRef, queue, current, playing, togglePlay, setPlaying, next, prev, showLyric, setShowLyric } = usePlayer()
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const rafRef = useRef(0)
  // 每首歌的自动重试计数：直链过期时换 src 触发后端重解，至多重试 2 次避免死循环
  const retryRef = useRef<{ id: string; n: number }>({ id: '', n: 0 })

  const song = queue[current]
  const src = song?.playable
    ? `/api/stream/${encodeURIComponent(song.id)}${reloadKey ? `?_r=${reloadKey}` : ''}`
    : null

  // 切歌时重置
  useEffect(() => {
    setCur(0)
    setDur(0)
    retryRef.current = { id: song?.id ?? '', n: 0 }
  }, [song?.id])

  // 直链过期 / 加载失败：换带 nonce 的 src 强制重新请求，后端会重解一条新直链
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onError = () => {
      const r = retryRef.current
      if (song && r.id === song.id && r.n < 2) {
        r.n += 1
        setReloadKey((k) => k + 1)
      }
    }
    a.addEventListener('error', onError)
    return () => a.removeEventListener('error', onError)
  }, [song, audioRef])

  // 切到新歌时自动播放（仅依赖 src，避免与原生 play/pause 事件形成回环）
  useEffect(() => {
    const a = audioRef.current
    if (!a || !src) return
    a.play().catch(() => {})
  }, [src, audioRef])

  // 时间更新 + 播放状态回写（外部控制时，<audio> 会触发原生 play/pause 事件）
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCur(a.currentTime)
    const onDur = () => setDur(a.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onDur)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', next)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onDur)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', next)
    }
  }, [next, setPlaying, audioRef])

  // Media Session：让锁屏 / 控制中心 / AirPods / 电脑媒体键显示正确信息并可控制
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    if (song) {
      ms.metadata = new MediaMetadata({
        title: song.song_name || '',
        artist: song.singers || '',
        album: song.album || '',
        artwork: song.cover_url ? [{ src: song.cover_url }] : [],
      })
    }
    ms.setActionHandler('play', () => togglePlay())
    ms.setActionHandler('pause', () => togglePlay())
    ms.setActionHandler('previoustrack', () => prev())
    ms.setActionHandler('nexttrack', () => next())
  }, [song, togglePlay, prev, next])

  // 同步播放状态到 Media Session，保证外部控件显示正确的播放/暂停图标
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  // 当前播放上下文用于歌词高亮
  const lyricLines = song ? parseLrc(queue[current]?.lyric) : []
  cancelAnimationFrame(rafRef.current)

  const pct = dur > 0 ? (cur / dur) * 100 : 0
  const fmt = (t: number) => {
    if (!isFinite(t)) return '00:00'
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // 点击/拖动进度条跳转到对应时间点
  const seekToClientX = (clientX: number, el: HTMLElement) => {
    const a = audioRef.current
    const d = a?.duration || dur
    if (!a || !d) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    a.currentTime = ratio * d
    setCur(ratio * d)
  }
  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!song) return
    const el = e.currentTarget
    seekToClientX(e.clientX, el)
    const move = (ev: PointerEvent) => seekToClientX(ev.clientX, el)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="player">
      <audio ref={audioRef} src={src ?? undefined} preload="metadata" />
      <div className="player-inner">
        <div className="player-info">
          {song?.cover_url ? (
            <img className="player-cover" src={song.cover_url} alt="" loading="lazy" />
          ) : (
            <div className="player-cover player-cover-empty"><Music2 size={20} /></div>
          )}
          <div className="player-meta">
            <div className="title">
              <span className="title-text">{song?.song_name || '未在播放'}</span>
              {song ? <QualityBadge tier={song.quality_tier} label={song.quality_label} detail={song.quality_detail} /> : null}
            </div>
            <div className="sub">{song?.singers}{song?.album ? ` · ${song.album}` : ''}</div>
          </div>
        </div>
        <div className="player-center">
          <div className="player-controls">
            <button className="icon" onClick={prev} disabled={!song} aria-label="上一首"><SkipBack size={18} fill="currentColor" /></button>
            <button className="icon primary" onClick={togglePlay} disabled={!song} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <button className="icon" onClick={next} disabled={!song} aria-label="下一首"><SkipForward size={18} fill="currentColor" /></button>
            <button className={`icon${showLyric ? ' on' : ''}`} onClick={() => setShowLyric(!showLyric)} disabled={!song || lyricLines.length === 0} aria-label="歌词"><MessageSquareQuote size={18} /></button>
          </div>
          <div className="progress-row">
            <span>{fmt(cur)}</span>
            <div
              className="bar-wrap"
              onPointerDown={onBarPointerDown}
              role="slider"
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.floor(dur) || 0}
              aria-valuenow={Math.floor(cur) || 0}
            >
              <progress className="bar" value={pct} max={100} />
            </div>
            <span>{fmt(dur)}</span>
          </div>
        </div>
        <div className="player-right" />
      </div>
    </div>
  )
}
