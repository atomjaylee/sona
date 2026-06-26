import { createContext, useContext } from 'react'
import type { SongInfo } from './types'
import type { RGB } from './palette'

export interface PlayerState {
  queue: SongInfo[]
  current: number
  playing: boolean
  lyric: string
  showLyric: boolean
}

export interface PlayerContextValue extends PlayerState {
  audioRef: React.RefObject<HTMLAudioElement | null>
  palette: RGB[]
  playSong: (song: SongInfo, queue?: SongInfo[]) => void
  togglePlay: () => void
  setPlaying: (v: boolean) => void
  next: () => void
  prev: () => void
  setQueue: (q: SongInfo[]) => void
  removeFromQueue: (index: number) => void
  setLyric: (s: string) => void
  setShowLyric: (v: boolean) => void
}

export const PlayerContext = createContext<PlayerContextValue | null>(null)

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}

export function streamSrc(song: SongInfo): string | null {
  if (!song.playable) return null
  return `/api/stream/${encodeURIComponent(song.id)}`
}
