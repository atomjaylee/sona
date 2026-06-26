import { createContext, useContext } from 'react'
import type { PlaylistSummary, SongInfo } from './types'

export interface PlaylistsContextValue {
  playlists: PlaylistSummary[]
  loading: boolean
  refresh: () => Promise<void>
  create: (name: string) => Promise<PlaylistSummary>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  addSong: (id: string, song: SongInfo) => Promise<void>
  removeSong: (id: string, songId: string) => Promise<void>
}

export const PlaylistsContext = createContext<PlaylistsContextValue | null>(null)

export function usePlaylists(): PlaylistsContextValue {
  const ctx = useContext(PlaylistsContext)
  if (!ctx) throw new Error('usePlaylists must be used within PlaylistsProvider')
  return ctx
}
