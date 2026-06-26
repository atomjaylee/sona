import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SongInfo } from './types'
import { coverProxy, fetchLyric } from './api'
import { PlayerContext, type PlayerState } from './player-context'
import { FALLBACK_PALETTE, extractPalette, type RGB } from './palette'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<PlayerState>({
    queue: [],
    current: -1,
    playing: false,
    lyric: '',
    showLyric: false,
  })

  // 当前歌曲封面的主题调色板：切歌时取一次，供歌词面板流动背景用
  const [palette, setPalette] = useState<RGB[]>(FALLBACK_PALETTE)
  const coverUrl = state.queue[state.current]?.cover_url
  useEffect(() => {
    if (!coverUrl) {
      setPalette(FALLBACK_PALETTE)
      return
    }
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      setPalette(extractPalette(img))
    }
    img.src = coverProxy(coverUrl)
    return () => {
      cancelled = true
    }
  }, [coverUrl])

  const playSong = useCallback(async (song: SongInfo, queue?: SongInfo[]) => {
    const q = queue ?? [song]
    const idx = q.findIndex((s) => s.id === song.id)
    const target = idx >= 0 ? idx : 0
    setState((s) => ({ ...s, queue: q, current: target, playing: true, lyric: '' }))
    // 异步获取歌词
    const lc = await fetchLyric(song.id).catch(() => '')
    setState((s) => ({ ...s, lyric: lc || song.lyric || '' }))
  }, [])

  // 直接操作 <audio>，播放状态由原生 play/pause 事件回写，保证与外部控制一致
  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }, [])

  // 由 <audio> 原生 play/pause 事件回写状态（外部控制：AirPods、媒体键、控制中心等）
  const setPlaying = useCallback((v: boolean) => {
    setState((s) => (s.playing === v ? s : { ...s, playing: v }))
  }, [])

  const next = useCallback(() => {
    setState((s) => {
      if (s.queue.length === 0) return s
      const n = (s.current + 1) % s.queue.length
      return { ...s, current: n, playing: true, lyric: '' }
    })
  }, [])

  const prev = useCallback(() => {
    setState((s) => {
      if (s.queue.length === 0) return s
      const n = (s.current - 1 + s.queue.length) % s.queue.length
      return { ...s, current: n, playing: true, lyric: '' }
    })
  }, [])

  const setQueue = useCallback((q: SongInfo[]) => {
    setState((s) => ({ ...s, queue: q, current: q.length ? Math.max(0, s.current) : -1 }))
  }, [])

  const removeFromQueue = useCallback((index: number) => {
    setState((s) => {
      const q = s.queue.filter((_, i) => i !== index)
      let c = s.current
      if (index < c) c -= 1
      if (q.length === 0) c = -1
      else if (c >= q.length) c = q.length - 1
      return { ...s, queue: q, current: c }
    })
  }, [])

  const setLyric = useCallback((lyric: string) => setState((s) => ({ ...s, lyric })), [])
  const setShowLyric = useCallback((showLyric: boolean) => setState((s) => ({ ...s, showLyric })), [])

  return (
    <PlayerContext.Provider
      value={{ ...state, palette, audioRef, playSong, togglePlay, setPlaying, next, prev, setQueue, removeFromQueue, setLyric, setShowLyric }}
    >
      {children}
    </PlayerContext.Provider>
  )
}
