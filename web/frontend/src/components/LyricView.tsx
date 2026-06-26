import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { usePlayer } from '../player-context'
import { fetchLyric } from '../api'
import { parseLrc, type LrcLine } from '../lrc'
import { FlowField } from './FlowField'

// 单个字/词：底色 + 点亮层（clip-path 从左向右揭开）。
// 揭开比例 = (当前时间 - 字开始) / (字时长)，所以被拖长的字时长大、揭开慢。
function Word({ word, t }: { word: { start: number; end: number; text: string }; t: number }) {
  const span = Math.max(word.end - word.start, 0.001)
  const ratio = Math.min(1, Math.max(0, (t - word.start) / span))
  const active = ratio > 0 && ratio < 1
  return (
    <span className={`kw${active ? ' kw-active' : ''}`}>
      <span className="kw-dim">{word.text}</span>
      <span className="kw-lit" style={{ clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0)` }} aria-hidden>
        {word.text}
      </span>
    </span>
  )
}

function Line({ line, state, t }: { line: LrcLine; state: 'past' | 'active' | 'future'; t: number }) {
  if (state !== 'active') {
    return <div className={`kline kline-${state}`}>{line.text || '♪'}</div>
  }
  // 有逐字时间 → 扫描点亮（拖长的字点亮变慢）；只有行级时间 → 整行立即点亮（与音频同步，不拖尾）
  if (line.karaoke && line.words.length > 0) {
    return (
      <div className="kline kline-active">
        {line.words.map((w, i) => (
          <Word key={i} word={w} t={t} />
        ))}
      </div>
    )
  }
  return <div className="kline kline-active kline-solid">{line.text || '♪'}</div>
}

export function LyricView() {
  const { queue, current, showLyric, setShowLyric, palette } = usePlayer()
  const [t, setT] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const [offset, setOffset] = useState(0)

  // 面板拖拽：默认用 CSS 的 right/bottom 定位；一旦用户拖动，切到 left/top 自由摆放
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  const clampToViewport = (x: number, y: number) => {
    const el = panelRef.current
    const w = el?.offsetWidth ?? 360
    const h = el?.offsetHeight ?? 320
    const maxX = Math.max(0, window.innerWidth - w)
    const maxY = Math.max(0, window.innerHeight - h)
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) }
  }

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    // 点在关闭按钮上时不启动拖拽，避免误触
    if ((e.target as HTMLElement).closest('.lyric-close')) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setPos({ x: rect.left, y: rect.top }) // 锁定当前位置，脱离 right/bottom
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 指针捕获不可用时忽略 */ }
  }

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPos(clampToViewport(e.clientX - drag.current.dx, e.clientY - drag.current.dy))
  }

  const onHeaderPointerUp = (e: React.PointerEvent) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // 窗口缩放时把面板拉回可视区，避免被挤出屏幕外
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampToViewport(p.x, p.y) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const song = queue[current]
  // 拉取当前歌曲歌词（网易源会返回逐字增强型 LRC），切歌时（含上一首/下一首）自动重新获取
  const [lyric, setLyric] = useState('')
  useEffect(() => {
    if (!song) {
      setLyric('')
      return
    }
    let cancelled = false
    setLyric(song.lyric || '')
    fetchLyric(song.id)
      .then((l) => {
        if (!cancelled && l) setLyric(l)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [song?.id])
  const lines = parseLrc(lyric)

  // 跟随播放进度（rAF，逐帧更新以驱动逐字扫描）
  useEffect(() => {
    const audio = document.querySelector<HTMLAudioElement>('audio')
    if (!audio) return
    const tick = () => {
      setT(audio.currentTime)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [song?.id])

  // 当前激活行：最后一个 time <= t 的行
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].time) active = i
    else break
  }

  // 平滑居中：把激活行平移到舞台垂直中线（transform，带弹性过渡）
  useLayoutEffect(() => {
    const stage = stageRef.current
    const track = trackRef.current
    if (!stage || !track || active < 0) return
    const el = track.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!el) return
    const next = stage.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2)
    setOffset(next)
  }, [active, song?.id, showLyric])

  if (!showLyric || lines.length === 0) return null

  return (
    <div
      className="lyric-panel"
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      <FlowField palette={palette} brightness={0.85} className="lyric-bg" />
      <div className="lyric-scrim" />
      <div
        className="lh lyric-drag"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <span>歌词</span>
        <button className="lyric-close" onClick={() => setShowLyric(false)} aria-label="关闭">
          <X size={16} />
        </button>
      </div>
      <div className="lyric-stage" ref={stageRef}>
        <div className="lyric-track" ref={trackRef} style={{ transform: `translateY(${offset}px)` }}>
          {lines.map((l, i) => (
            <div key={i} data-i={i}>
              <Line line={l} state={i === active ? 'active' : i < active ? 'past' : 'future'} t={t} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
