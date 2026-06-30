import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, Play, ListMusic, Loader2 } from 'lucide-react'
import type { HotPlaylist, SongInfo } from '../types'
import { getHotPlaylists, subscribePlaylist, coverProxy } from '../api'
import { usePlayer } from '../player-context'
import { SongTable } from './SongTable'

const TABS: { source: string; label: string }[] = [
  { source: 'NeteaseMusicClient', label: '网易云' },
  { source: 'QQMusicClient', label: 'QQ 音乐' },
]

/** 播放量友好显示：1.2万 / 3.4亿。 */
function fmtCount(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

function PlaylistCard({ pl, onOpen }: { pl: HotPlaylist; onOpen: (pl: HotPlaylist) => void }) {
  return (
    <button className="pl-card" onClick={() => onOpen(pl)} title={pl.name}>
      <div className="pl-cover">
        {pl.cover_url ? (
          <img src={coverProxy(pl.cover_url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div className="pl-cover-empty"><ListMusic size={28} /></div>
        )}
        {pl.play_count > 0 ? (
          <span className="hot-play-count"><Play size={11} fill="currentColor" /> {fmtCount(pl.play_count)}</span>
        ) : null}
      </div>
      <div className="pl-card-name">{pl.name}</div>
      {pl.creator ? <div className="pl-card-count">{pl.creator}</div> : null}
    </button>
  )
}

function PlaylistDetailView({ pl, onBack }: { pl: HotPlaylist; onBack: () => void }) {
  const { playSong } = usePlayer()
  const [songs, setSongs] = useState<SongInfo[]>([])
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 按原始 index 收集，保证曲目/播放队列保持歌单原顺序；并按 song.id 去重（歌单可能有重复曲目）
  const byIndexRef = useRef<Map<number, SongInfo>>(new Map())

  useEffect(() => {
    setLoading(true)
    setError('')
    setSongs([])
    setTotal(0)
    setDone(0)
    byIndexRef.current = new Map()
    // 流式解析：解一首推一首，避免上百首歌单整批阻塞导致「一直解析」
    const close = subscribePlaylist(
      pl.url,
      pl.source,
      (t) => {
        setTotal(t)
        if (t === 0) {
          setError('未解析到歌曲，或该歌单需登录/不支持')
          setLoading(false)
        }
      },
      (batch) => {
        setDone(batch.done)
        if (!batch.song) return
        // 按 index 插入保持原顺序，再按 id 去重，避免重复曲目出现两行
        byIndexRef.current.set(batch.index, batch.song)
        const seen = new Set<string>()
        const ordered = [...byIndexRef.current.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, s]) => s)
          .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
        setSongs(ordered)
      },
      (ok) => {
        setLoading(false)
        // 连接中断且一首都没解析出来：明确报错，避免把空列表当成「解析成功」
        if (!ok && byIndexRef.current.size === 0) setError('解析中断，请重试')
      },
    )
    return close
  }, [pl.url, pl.source])

  return (
    <>
      <button className="pl-back" onClick={onBack}>
        <ChevronLeft size={18} /> 热门歌单
      </button>

      <section className="pl-detail-head">
        <div className="pl-cover">
          {pl.cover_url ? (
            <img src={coverProxy(pl.cover_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div className="pl-cover-empty"><ListMusic size={28} /></div>
          )}
        </div>
        <div className="pl-detail-meta">
          <div className="pl-detail-kind">歌单</div>
          <h1 className="pl-detail-title">{pl.name}</h1>
          <div className="pl-detail-sub">
            {pl.creator ? `${pl.creator} · ` : ''}
            {loading && total > 0
              ? `解析中 ${done}/${total}`
              : `${songs.length} 首${pl.play_count > 0 ? ` · 播放 ${fmtCount(pl.play_count)}` : ''}`}
          </div>
          <div className="pl-detail-actions">
            <button className="pl-play-all" onClick={() => songs.length && playSong(songs[0], songs)} disabled={!songs.length}>
              <Play size={16} fill="currentColor" /> 播放全部
            </button>
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
          </div>
        </div>
      </section>

      {error ? (
        <div className="notice err">{error}</div>
      ) : songs.length === 0 && loading ? (
        <div className="empty"><Loader2 size={20} className="animate-spin" /> 正在解析歌单…</div>
      ) : (
        <SongTable songs={songs} />
      )}
    </>
  )
}

export function HotPlaylists() {
  const [source, setSource] = useState(TABS[0].source)
  const [open, setOpen] = useState<HotPlaylist | null>(null)
  // 每个源的歌单结果缓存在父组件，切 tab 不重复请求、保留滚动外的数据
  const [cache, setCache] = useState<Record<string, HotPlaylist[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (cache[source] || loadingRef.current.has(source)) return
    loadingRef.current.add(source)
    setLoading(true)
    setError('')
    getHotPlaylists(source)
      .then((r) => {
        setCache((c) => ({ ...c, [source]: r.playlists }))
        if (r.total === 0) setError('暂时没有拉到热门歌单，请稍后再试')
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => {
        loadingRef.current.delete(source)
        setLoading(false)
      })
  }, [source, cache])

  if (open) return <PlaylistDetailView pl={open} onBack={() => setOpen(null)} />

  const items = cache[source]

  return (
    <>
      <section className="view-head">
        <h1>热门歌单</h1>
        <p className="view-sub">网易云精品歌单 · QQ 音乐歌单广场，点击即可解析全部曲目</p>
      </section>

      <div className="source-tabs">
        {TABS.map((t) => (
          <button
            key={t.source}
            className={`source-tab${source === t.source ? ' active' : ''}`}
            onClick={() => setSource(t.source)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!items && loading ? (
        <div className="empty"><Loader2 size={20} className="animate-spin" /> 加载中…</div>
      ) : !items && error ? (
        <div className="notice err">{error}</div>
      ) : (
        <div className="pl-grid">
          {(items || []).map((pl) => (
            <PlaylistCard key={pl.id} pl={pl} onOpen={setOpen} />
          ))}
        </div>
      )}
    </>
  )
}
