import { useEffect, useRef } from 'react'
import { usePlayer } from './player-context'

// 浏览器标签页的「正在播放」呈现：
// - document.title 跟随当前曲目动态变更（播放 ▶ / 暂停 ⏸ + 歌名 — 歌手）
// - favicon 用 canvas 实时绘制成律动均衡器：播放时声柱跳动，暂停时静止，无歌时移除恢复默认
const DEFAULT_TITLE = 'Sona'
const ACCENT = '#1ed760'
const FAVICON_ID = 'now-playing-favicon'

function ensureFaviconLink(): HTMLLinkElement {
  let link = document.getElementById(FAVICON_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = FAVICON_ID
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  return link
}

export function useNowPlayingTab() {
  const { queue, current, playing } = usePlayer()
  const song = current >= 0 ? queue[current] : undefined
  const name = song?.song_name?.trim() || ''
  const singers = song?.singers?.trim() || ''
  const hasSong = !!name
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // ---- 动态标题 ----
  useEffect(() => {
    document.title = hasSong
      ? `${playing ? '▶' : '⏸'} ${name}${singers ? ' — ' + singers : ''}`
      : DEFAULT_TITLE
  }, [hasSong, name, singers, playing])

  // 组件卸载时复位标题
  useEffect(() => () => { document.title = DEFAULT_TITLE }, [])

  // ---- 动态 favicon（均衡器）----
  useEffect(() => {
    if (!hasSong) {
      document.getElementById(FAVICON_ID)?.remove()
      return
    }
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'))
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const link = ensureFaviconLink()

    const BARS = 4
    const PAUSED = [0.5, 0.85, 0.4, 0.7]
    let phase = 0

    const draw = () => {
      const W = canvas.width
      const H = canvas.height
      const pad = 9
      const gap = 5
      const bw = (W - pad * 2 - gap * (BARS - 1)) / BARS
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = ACCENT
      for (let i = 0; i < BARS; i++) {
        const t = playing ? 0.5 + 0.5 * Math.sin(phase + i * 1.1) : PAUSED[i]
        const bh = Math.max(6, t * (H - pad * 2))
        const x = pad + i * (bw + gap)
        const y = H - pad - bh
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2)
        else ctx.rect(x, y, bw, bh)
        ctx.fill()
      }
      link.href = canvas.toDataURL('image/png')
    }

    draw()
    if (!playing) return
    const id = window.setInterval(() => {
      phase += 0.45
      draw()
    }, 120)
    return () => window.clearInterval(id)
  }, [hasSong, playing])
}
