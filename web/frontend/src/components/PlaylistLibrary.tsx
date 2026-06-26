import { useCallback, useEffect, useState } from 'react'
import { Plus, Play, Trash2, Pencil, ChevronLeft, ListMusic, Music2 } from 'lucide-react'
import type { PlaylistDetail, SongInfo } from '../types'
import { usePlaylists } from '../playlists-context'
import { usePlayer } from '../player-context'
import { getPlaylist, coverProxy } from '../api'
import { SongTable } from './SongTable'

/** 歌单封面：最多 4 张拼图，无封面时占位。 */
function CoverCollage({ covers }: { covers: string[] }) {
  if (covers.length === 0) {
    return (
      <div className="pl-cover pl-cover-empty">
        <ListMusic size={28} />
      </div>
    )
  }
  const cells = covers.slice(0, 4)
  return (
    <div className={`pl-cover pl-cover-grid n${cells.length}`}>
      {cells.map((c, i) => (
        <img key={i} src={coverProxy(c)} alt="" loading="lazy" />
      ))}
    </div>
  )
}

function LibraryGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const { playlists, loading, create } = usePlaylists()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const submit = async () => {
    const n = name.trim()
    if (!n) return
    const p = await create(n)
    setName('')
    setCreating(false)
    onOpen(p.id)
  }

  return (
    <>
      <section className="view-head pl-lib-head">
        <div>
          <h1>我的歌单</h1>
          <p className="view-sub">把喜欢的歌整合到歌单里，随时回来接着听</p>
        </div>
        {creating ? (
          <div className="pl-create-inline">
            <input
              autoFocus
              className="pl-menu-input"
              placeholder="歌单名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
                if (e.key === 'Escape') setCreating(false)
              }}
            />
            <button className="pl-menu-confirm" onClick={() => void submit()}>创建</button>
          </div>
        ) : (
          <button className="pl-new-btn" onClick={() => setCreating(true)}>
            <Plus size={16} /> 新建歌单
          </button>
        )}
      </section>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : playlists.length === 0 ? (
        <div className="empty">还没有歌单。点击「新建歌单」，再在搜索结果里用 + 把歌加进来</div>
      ) : (
        <div className="pl-grid">
          {playlists.map((p) => (
            <button key={p.id} className="pl-card" onClick={() => onOpen(p.id)}>
              <CoverCollage covers={p.covers} />
              <div className="pl-card-name">{p.name}</div>
              <div className="pl-card-count">{p.song_count} 首</div>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function PlaylistDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { rename, remove, removeSong } = usePlaylists()
  const { playSong } = usePlayer()
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')

  const reload = useCallback(async () => {
    try {
      setDetail(await getPlaylist(id))
    } catch {
      onBack()
    }
  }, [id, onBack])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!detail) return <div className="empty">加载中…</div>

  const songs = detail.songs
  const playAll = () => {
    if (songs.length) playSong(songs[0], songs)
  }
  const submitRename = async () => {
    const n = name.trim()
    if (n && n !== detail.name) await rename(id, n)
    setEditing(false)
    await reload()
  }
  const handleRemoveSong = async (song: SongInfo) => {
    await removeSong(id, song.id)
    await reload()
  }
  const handleDelete = async () => {
    if (!window.confirm(`删除歌单「${detail.name}」？歌单里的歌不会从音乐源删除。`)) return
    await remove(id)
    onBack()
  }

  return (
    <>
      <button className="pl-back" onClick={onBack}>
        <ChevronLeft size={18} /> 我的歌单
      </button>

      <section className="pl-detail-head">
        <CoverCollage covers={detail.covers} />
        <div className="pl-detail-meta">
          <div className="pl-detail-kind">歌单</div>
          {editing ? (
            <div className="pl-create-inline">
              <input
                autoFocus
                className="pl-menu-input pl-rename-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename()
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
              <button className="pl-menu-confirm" onClick={() => void submitRename()}>保存</button>
            </div>
          ) : (
            <h1 className="pl-detail-title">
              {detail.name}
              <button
                className="pl-icon-btn"
                title="重命名"
                onClick={() => {
                  setName(detail.name)
                  setEditing(true)
                }}
              >
                <Pencil size={15} />
              </button>
            </h1>
          )}
          <div className="pl-detail-sub">{songs.length} 首</div>
          <div className="pl-detail-actions">
            <button className="pl-play-all" onClick={playAll} disabled={!songs.length}>
              <Play size={16} fill="currentColor" /> 播放全部
            </button>
            <button className="pl-icon-btn danger" title="删除歌单" onClick={handleDelete}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </section>

      {songs.length === 0 ? (
        <div className="empty">
          <Music2 size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
          <div>歌单还是空的。去搜索里用每行的 + 把歌加进来</div>
        </div>
      ) : (
        <SongTable songs={songs} onRemove={handleRemoveSong} />
      )}
    </>
  )
}

export function PlaylistLibrary() {
  const [openId, setOpenId] = useState<string | null>(null)
  return openId ? (
    <PlaylistDetailView id={openId} onBack={() => setOpenId(null)} />
  ) : (
    <LibraryGrid onOpen={setOpenId} />
  )
}
