import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { PlaylistSummary, SongInfo } from './types'
import * as api from './api'
import { PlaylistsContext } from './playlists-context'

export function PlaylistsProvider({ children }: { children: ReactNode }) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setPlaylists(await api.listPlaylists())
    } catch {
      // 网络/服务端异常时保持上一次列表，不打断使用
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (name: string) => {
      const p = await api.createPlaylist(name)
      await refresh()
      return p
    },
    [refresh],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      await api.renamePlaylist(id, name)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await api.deletePlaylist(id)
      await refresh()
    },
    [refresh],
  )

  const addSong = useCallback(
    async (id: string, song: SongInfo) => {
      await api.addSongToPlaylist(id, song)
      await refresh()
    },
    [refresh],
  )

  const removeSong = useCallback(
    async (id: string, songId: string) => {
      await api.removeSongFromPlaylist(id, songId)
      await refresh()
    },
    [refresh],
  )

  return (
    <PlaylistsContext.Provider
      value={{ playlists, loading, refresh, create, rename, remove, addSong, removeSong }}
    >
      {children}
    </PlaylistsContext.Provider>
  )
}
