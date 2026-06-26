import { useState } from 'react'
import { Search, Link2, ListMusic, Heart, type LucideIcon } from 'lucide-react'
import { PlayerProvider } from './player-provider'
import { PlaylistsProvider } from './playlists-provider'
import { usePlayer } from './player-context'
import { Player } from './components/Player'
import { LyricView } from './components/LyricView'
import { SearchView } from './components/SearchView'
import { PlaylistPanel } from './components/PlaylistPanel'
import { PlaylistParser } from './components/PlaylistParser'
import { PlaylistLibrary } from './components/PlaylistLibrary'
import { useNowPlayingTab } from './use-now-playing-tab'

type Tab = 'search' | 'library' | 'playlist' | 'queue'

const NAV: { key: Tab; Icon: LucideIcon; label: string }[] = [
  { key: 'search', Icon: Search, label: '搜索' },
  { key: 'library', Icon: Heart, label: '我的歌单' },
  { key: 'playlist', Icon: Link2, label: '歌单解析' },
  { key: 'queue', Icon: ListMusic, label: '播放队列' },
]

function Shell() {
  const [tab, setTab] = useState<Tab>('search')
  const { queue } = usePlayer()
  useNowPlayingTab()

  return (
    <div className="app">
      <aside className="sidebar">
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-item ${tab === n.key ? 'active' : ''}`}
              onClick={() => setTab(n.key)}
            >
              <span className="nav-icon"><n.Icon size={18} /></span>
              <span className="nav-label">{n.label}</span>
              {n.key === 'queue' && queue.length ? <span className="nav-count">{queue.length}</span> : null}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        {/* 用 hidden 而非卸载，保留各 tab 内部 state（搜索结果、歌单结果等） */}
        <div className="tab-pane" hidden={tab !== 'search'}>
          <SearchView />
        </div>
        <div hidden={tab !== 'library'}>
          <PlaylistLibrary />
        </div>
        <div hidden={tab !== 'playlist'}>
          <section className="view-head">
            <h1>歌单解析</h1>
            <p className="view-sub">粘贴网易云 / 咪咕等歌单链接，解析全部曲目</p>
          </section>
          <PlaylistParser />
        </div>
        <div hidden={tab !== 'queue'}>
          <section className="view-head">
            <h1>播放队列</h1>
            <p className="view-sub">当前播放列表中的曲目</p>
          </section>
          <PlaylistPanel />
        </div>
      </main>

      <Player />
      <LyricView />
    </div>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <PlaylistsProvider>
        <Shell />
      </PlaylistsProvider>
    </PlayerProvider>
  )
}
