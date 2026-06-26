import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { subscribeSearch, searchAlbum, type SearchBatch } from '../api'
import type { AlbumInfo, SongInfo } from '../types'
import { SongTable } from './SongTable'
import { AlbumGrid } from './AlbumGrid'
import { AlbumDetail } from './AlbumDetail'
import { SearchEmpty } from './SearchEmpty'
import { sourceLabel, sourceIconUrl } from '../source-label'
import { Input } from './ui/input'
import { Button } from './ui/button'

type Mode = 'song' | 'album'

// 来源 tab 的优先展示顺序（其余源排后面）
const SOURCE_ORDER = ['MiguMusicClient', 'NeteaseMusicClient', 'QQMusicClient', 'KuwoMusicClient']

export function SearchView() {
  const [mode, setMode] = useState<Mode>('song')

  // 歌曲 / 专辑两套独立状态：切换模式只改显示，互不清空，来回切可完整恢复
  const [songKw, setSongKw] = useState('')
  const [songLoading, setSongLoading] = useState(false)
  const [songLoadingMore, setSongLoadingMore] = useState(false)
  const [songSearched, setSongSearched] = useState(false)
  const [songError, setSongError] = useState('')
  const [songs, setSongs] = useState<SongInfo[]>([])
  const [songPage, setSongPage] = useState(1)
  const [songHasMore, setSongHasMore] = useState(true)
  const [doneCount, setDoneCount] = useState(0)
  const [totalSources, setTotalSources] = useState(0)
  const [sourceFilter, setSourceFilter] = useState<string>('all') // 来源 tab 过滤
  const songIdsRef = useRef<Set<string>>(new Set()) // 跨页去重
  const inFlightRef = useRef(false) // 同步防抖：避免触底回调并发重复加载
  const esCloseRef = useRef<(() => void) | null>(null) // 当前歌曲检索流的关闭句柄（用于打断上一次）
  const albumAbortRef = useRef<AbortController | null>(null) // 当前专辑检索的 abort 控制器

  const [albumKw, setAlbumKw] = useState('')
  const [albumLoading, setAlbumLoading] = useState(false)
  const [albumSearched, setAlbumSearched] = useState(false)
  const [albumError, setAlbumError] = useState('')
  const [albums, setAlbums] = useState<AlbumInfo[]>([])
  const [albumSourceFilter, setAlbumSourceFilter] = useState<string>('all') // 专辑来源 tab 过滤
  const [selected, setSelected] = useState<AlbumInfo | null>(null)

  // 各来源命中数 + tab 顺序（已出现的源里，按 SOURCE_ORDER 优先排，其余追加）
  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of songs) {
      const k = s.source || '?'
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [songs])
  const sourceTabs = useMemo(() => {
    const present = Object.keys(sourceCounts)
    return [
      ...SOURCE_ORDER.filter((s) => present.includes(s)),
      ...present.filter((s) => !SOURCE_ORDER.includes(s)),
    ]
  }, [sourceCounts])
  const visibleSongs = useMemo(
    () => (sourceFilter === 'all' ? songs : songs.filter((s) => s.source === sourceFilter)),
    [songs, sourceFilter],
  )

  // 专辑结果按来源分 tab（网易 / QQ），顺序同 SOURCE_ORDER
  const albumSourceCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of albums) {
      const k = a.source || '?'
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [albums])
  const albumSourceTabs = useMemo(() => {
    const present = Object.keys(albumSourceCounts)
    return [
      ...SOURCE_ORDER.filter((s) => present.includes(s)),
      ...present.filter((s) => !SOURCE_ORDER.includes(s)),
    ]
  }, [albumSourceCounts])
  const visibleAlbums = useMemo(
    () => (albumSourceFilter === 'all' ? albums : albums.filter((a) => a.source === albumSourceFilter)),
    [albums, albumSourceFilter],
  )

  // 当前模式视图的派生值
  const keyword = mode === 'song' ? songKw : albumKw
  const setKeyword = mode === 'song' ? setSongKw : setAlbumKw
  const loading = mode === 'song' ? songLoading : albumLoading
  const searched = mode === 'song' ? songSearched : albumSearched
  const error = mode === 'song' ? songError : albumError

  // 二级页面（专辑详情）：用 history 栈承载，使浏览器后退键可从详情返回列表
  useEffect(() => {
    const onPop = () => setSelected(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 组件卸载时关闭仍在进行的检索流 / 请求，避免泄漏
  useEffect(() => {
    return () => {
      esCloseRef.current?.()
      albumAbortRef.current?.abort()
    }
  }, [])

  // 滚动后给滚动容器加 .scrolled，让表头浮现吸顶阴影（纯 DOM，不触发重渲染）
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.classList.toggle('scrolled', el.scrollTop > 0)
  }

  const openAlbum = (album: AlbumInfo) => {
    setSelected(album)
    window.history.pushState({ albumDetail: album.album_id }, '')
  }
  const closeAlbum = () => window.history.back()

  // 从歌曲列表点专辑名跳转：用歌曲信息拼出 AlbumInfo（song_count/publish_time 详情页再补）
  const openAlbumFromSong = (song: SongInfo) => {
    if (!song.album_id) return
    openAlbum({
      album_id: song.album_id,
      album_name: song.album,
      singers: song.singers,
      cover_url: song.cover_url,
      song_count: 0,
      publish_time: null,
      source: song.source,
    })
  }

  // 单次歌曲检索（page=1 为新搜索，page>1 为加载更多）
  const runSongSearch = (kw: string, page: number) => {
    // 打断上一次仍在推送的检索流（避免旧结果继续涌入 / 新搜索被卡住等待）
    esCloseRef.current?.()
    esCloseRef.current = null
    if (page === 1) {
      setSongLoading(true)
      setSongError('')
      setSongSearched(true)
      setSongs([])
      setSongPage(1)
      setSongHasMore(true)
      setDoneCount(0)
      setTotalSources(0)
      setSourceFilter('all')
      songIdsRef.current = new Set()
      inFlightRef.current = false
    } else {
      setSongLoadingMore(true)
    }
    let added = 0
    esCloseRef.current = subscribeSearch(
      kw,
      (batch: SearchBatch) => {
        setTotalSources(batch.total_sources)
        setDoneCount(batch.done)
        const fresh = batch.songs.filter((s) => !songIdsRef.current.has(s.id))
        if (fresh.length > 0) {
          fresh.forEach((s) => songIdsRef.current.add(s.id))
          added += fresh.length
          setSongs((prev) => [...prev, ...fresh])
        }
      },
      () => {
        esCloseRef.current = null
        inFlightRef.current = false
        setSongPage(page)
        if (added === 0) setSongHasMore(false) // 本页无新增 => 已到底
        if (page === 1) {
          setSongLoading(false)
          if (songIdsRef.current.size === 0) setSongError('未找到可下载的歌曲')
        } else {
          setSongLoadingMore(false)
        }
      },
      page,
    )
  }

  const loadMoreSongs = () => {
    if (inFlightRef.current) return
    if (mode !== 'song' || !songSearched || songLoading || songLoadingMore || !songHasMore) return
    const kw = songKw.trim()
    if (!kw) return
    inFlightRef.current = true
    runSongSearch(kw, songPage + 1)
  }

  const searchAlbums = async (kw: string) => {
    // 打断上一次未完成的专辑检索
    albumAbortRef.current?.abort()
    const ctrl = new AbortController()
    albumAbortRef.current = ctrl
    setAlbumLoading(true)
    setAlbumError('')
    setAlbumSearched(true)
    setAlbums([])
    setAlbumSourceFilter('all')
    setSelected(null)
    try {
      const res = await searchAlbum(kw, ctrl.signal)
      setAlbums(res.albums)
      if (res.albums.length === 0) setAlbumError('未找到相关专辑')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return // 被新搜索打断，忽略
      setAlbumError('专辑检索失败，请重试')
    } finally {
      if (albumAbortRef.current === ctrl) {
        albumAbortRef.current = null
        setAlbumLoading(false)
      }
    }
  }

  // 允许打断上一次检索：新搜索不再被 loading 卡住
  const handleSearch = () => {
    const kw = keyword.trim()
    if (!kw) return
    if (mode === 'album') searchAlbums(kw)
    else runSongSearch(kw, 1)
  }

  // 空状态热门搜索：填入关键词并立即按当前模式检索
  const quickSearch = (kw: string) => {
    setKeyword(kw)
    if (mode === 'album') searchAlbums(kw)
    else runSongSearch(kw, 1)
  }

  // 触底加载更多：观察列表底部哨兵元素（滚动容器是内部的 .search-body）
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const root = el.closest('.search-body')
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMoreSongs(),
      { root, rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, songSearched, songLoading, songLoadingMore, songHasMore, songPage, songKw, songs.length])

  // 二级页面：专辑详情（独占视图）。可来自专辑搜索，也可来自歌曲列表点专辑名；返回回到原视图
  if (selected) {
    return (
      <div className="search-view">
        <section className="view-head">
          <h1>搜索</h1>
        </section>
        <div className="search-body" onScroll={onBodyScroll}>
          <AlbumDetail album={selected} onBack={closeAlbum} />
        </div>
      </div>
    )
  }

  return (
    <div className="search-view">
      <section className="view-head">
        <h1>搜索</h1>
      </section>

      {/* 固定头部：模式 tab / 搜索框 / 来源 tab —— 不随列表滚动 */}
      <div className="search-head">
        <div className="search-mode">
          <button className={`mode-tab${mode === 'song' ? ' active' : ''}`} onClick={() => setMode('song')}>
            歌曲
          </button>
          <button className={`mode-tab${mode === 'album' ? ' active' : ''}`} onClick={() => setMode('album')}>
            专辑
          </button>
        </div>

        <div className="search-bar">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={mode === 'album' ? '输入专辑名，回车搜索（网易云 / QQ）' : '想听什么？输入歌曲 / 歌手名，回车搜索'}
              value={keyword}
              autoFocus
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="h-11 rounded-full bg-secondary border-transparent pl-11 text-sm"
            />
          </div>
          <Button onClick={handleSearch} disabled={loading || !keyword.trim()} className="h-11 rounded-full px-7 font-bold gap-2">
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {mode === 'song' && totalSources > 0 ? `检索中 ${doneCount}/${totalSources}` : '检索中…'}
              </>
            ) : (
              '搜索'
            )}
          </Button>
        </div>

        {mode === 'song' && songLoading && totalSources > 0 ? (
          <div className="search-progress">
            <div className="search-progress-bar" style={{ width: `${(doneCount / totalSources) * 100}%` }} />
          </div>
        ) : null}

        {error ? <div className="notice err">{error}</div> : null}

        {mode === 'song' && songs.length > 0 && sourceTabs.length > 1 ? (
          <div className="source-tabs">
            <button
              className={`source-tab${sourceFilter === 'all' ? ' active' : ''}`}
              onClick={() => setSourceFilter('all')}
            >
              全部 <span className="source-tab-cnt">{songs.length}</span>
            </button>
            {sourceTabs.map((src) => {
              const icon = sourceIconUrl(src)
              return (
                <button
                  key={src}
                  className={`source-tab${sourceFilter === src ? ' active' : ''}`}
                  onClick={() => setSourceFilter(src)}
                >
                  {icon ? <img src={icon} alt="" className="source-tab-icon" /> : null}
                  {sourceLabel(src)} <span className="source-tab-cnt">{sourceCounts[src]}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {mode === 'album' && albums.length > 0 && albumSourceTabs.length > 1 ? (
          <div className="source-tabs">
            <button
              className={`source-tab${albumSourceFilter === 'all' ? ' active' : ''}`}
              onClick={() => setAlbumSourceFilter('all')}
            >
              全部 <span className="source-tab-cnt">{albums.length}</span>
            </button>
            {albumSourceTabs.map((src) => {
              const icon = sourceIconUrl(src)
              return (
                <button
                  key={src}
                  className={`source-tab${albumSourceFilter === src ? ' active' : ''}`}
                  onClick={() => setAlbumSourceFilter(src)}
                >
                  {icon ? <img src={icon} alt="" className="source-tab-icon" /> : null}
                  {sourceLabel(src)} <span className="source-tab-cnt">{albumSourceCounts[src]}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* 仅此区域内部滚动 */}
      <div className="search-body" onScroll={onBodyScroll}>
        {mode === 'album' ? (
          albums.length > 0 ? (
            <AlbumGrid albums={visibleAlbums} onSelect={openAlbum} />
          ) : searched && !loading && !error ? (
            <div className="empty">无结果</div>
          ) : !searched ? (
            <SearchEmpty mode="album" onPick={quickSearch} />
          ) : loading ? (
            <div className="empty">
              <Loader2 size={24} className="mx-auto mb-3 animate-spin opacity-70" />
              正在检索专辑…
            </div>
          ) : null
        ) : songs.length > 0 ? (
          <>
            {visibleSongs.length > 0 ? (
              <SongTable songs={visibleSongs} onAlbumClick={openAlbumFromSong} />
            ) : (
              <div className="empty">该来源暂无结果</div>
            )}
            <div ref={sentinelRef} className="load-more-sentinel" aria-hidden />
            {songLoadingMore ? (
              <div className="load-more">
                <Loader2 size={18} className="animate-spin" /> 加载更多…
              </div>
            ) : !songHasMore ? (
              <div className="load-more done">没有更多了</div>
            ) : null}
          </>
        ) : searched && !loading && !error ? (
          <div className="empty">无结果</div>
        ) : !searched ? (
          <SearchEmpty mode="song" onPick={quickSearch} />
        ) : loading ? (
          <div className="empty">
            <Loader2 size={24} className="mx-auto mb-3 animate-spin opacity-70" />
            正在检索{totalSources > 0 ? ` ${doneCount}/${totalSources} 个音乐源` : '…'}
          </div>
        ) : null}
      </div>
    </div>
  )
}
