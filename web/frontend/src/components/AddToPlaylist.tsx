import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Check, ListMusic } from 'lucide-react'
import type { SongInfo } from '../types'
import { usePlaylists } from '../playlists-context'

/** 歌曲行上的「加入歌单」按钮：点击弹出歌单菜单，可选已有歌单或新建。 */
export function AddToPlaylist({ song }: { song: SongInfo }) {
  const { playlists, create, addSong } = usePlaylists()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [addedTo, setAddedTo] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // menu 用 fixed 定位锚到按钮下方，避免被表格 overflow 裁掉
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const width = 240
    const left = Math.min(r.right - width, window.innerWidth - width - 8)
    setPos({ top: r.bottom + 6, left: Math.max(8, left) })
  }, [open])

  // 点击菜单外或滚动/Esc 时关闭
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', () => setOpen(false), true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const flash = (id: string) => {
    setAddedTo(id)
    window.setTimeout(() => setAddedTo((v) => (v === id ? null : v)), 1200)
  }

  const handleAdd = async (id: string) => {
    await addSong(id, song)
    flash(id)
    setOpen(false)
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    const p = await create(name)
    await addSong(p.id, song)
    setNewName('')
    setCreating(false)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        className="add-btn"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        title="加入歌单"
        aria-label="加入歌单"
      >
        <Plus size={16} />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="pl-menu"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="pl-menu-head">加入歌单</div>
              <div className="pl-menu-list">
                {playlists.length === 0 ? (
                  <div className="pl-menu-empty">还没有歌单，新建一个吧</div>
                ) : (
                  playlists.map((p) => (
                    <button key={p.id} className="pl-menu-item" onClick={() => handleAdd(p.id)}>
                      <ListMusic size={15} />
                      <span className="pl-menu-name">{p.name}</span>
                      <span className="pl-menu-count">{p.song_count}</span>
                      {addedTo === p.id ? <Check size={15} className="pl-menu-check" /> : null}
                    </button>
                  ))
                )}
              </div>
              {creating ? (
                <div className="pl-menu-create">
                  <input
                    autoFocus
                    className="pl-menu-input"
                    placeholder="歌单名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreate()
                      if (e.key === 'Escape') setCreating(false)
                    }}
                  />
                  <button className="pl-menu-confirm" onClick={() => void handleCreate()}>
                    创建
                  </button>
                </div>
              ) : (
                <button className="pl-menu-new" onClick={() => setCreating(true)}>
                  <Plus size={15} /> 新建歌单
                </button>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
