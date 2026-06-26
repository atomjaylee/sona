import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { parsePlaylist } from '../api'
import type { SongInfo } from '../types'
import { SongTable } from './SongTable'
import { Input } from './ui/input'
import { Button } from './ui/button'

export function PlaylistParser() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [songs, setSongs] = useState<SongInfo[]>([])
  const [error, setError] = useState('')

  const handleParse = async () => {
    if (!url.trim()) return
    setLoading(true)
    setError('')
    setSongs([])
    try {
      const r = await parsePlaylist(url.trim())
      setSongs(r.songs)
      if (r.total === 0) setError('未解析到歌曲，或该源需登录/不支持')
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="row-input" style={{ marginBottom: 16 }}>
        <Input
          placeholder="粘贴歌单 URL，例如 https://music.163.com/#/playlist?id=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleParse()}
          className="h-11 flex-1 bg-secondary border-transparent"
        />
        <Button onClick={handleParse} disabled={loading || !url.trim()} className="h-11 px-6 font-bold">
          {loading ? <><Loader2 className="animate-spin" /> 解析中…</> : '解析歌单'}
        </Button>
      </div>
      {error ? <div className="notice err">{error}</div> : null}
      {songs.length > 0 ? <SongTable songs={songs} /> : null}
    </div>
  )
}
