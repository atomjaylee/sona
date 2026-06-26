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
    <div className="lyric-panel">
      <FlowField palette={palette} brightness={0.85} className="lyric-bg" />
      <div className="lyric-scrim" />
      <div className="lh">
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
