import { TrendingUp, Music2 } from 'lucide-react'
import { SourceBadge } from './SourceBadge'

/** 检索前的空状态：欢迎页 + 聚合音源 + 可点击热门搜索（点击直接发起检索）。 */

const HOT_SONG = ['周杰伦', '林俊杰', '邓紫棋', '陈奕迅', '五月天', 'Taylor Swift', '李荣浩', '孙燕姿']
const HOT_ALBUM = ['范特西', '叶惠美', '七里香', '十一月的萧邦', '理性与感性', 'Magic']
const SOURCES = ['NeteaseMusicClient', 'QQMusicClient', 'KuwoMusicClient']

export function SearchEmpty({ mode, onPick }: { mode: 'song' | 'album'; onPick: (kw: string) => void }) {
  const hots = mode === 'album' ? HOT_ALBUM : HOT_SONG
  return (
    <div className="search-empty">
      <div className="se-icon" aria-hidden>
        <Music2 size={30} strokeWidth={1.75} />
      </div>

      <h2 className="se-title">{mode === 'album' ? '搜索专辑' : '想听什么？'}</h2>
      <p className="se-sub">聚合网易云 · QQ · 酷我，一次搜遍全网音源</p>

      <div className="se-sources">
        {SOURCES.map((s) => (
          <SourceBadge key={s} source={s} showLabel />
        ))}
      </div>

      <div className="se-hot">
        <span className="se-hot-label">
          <TrendingUp size={13} /> 热门搜索
        </span>
        <div className="se-chips">
          {hots.map((h) => (
            <button key={h} className="se-chip" onClick={() => onPick(h)}>
              {h}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
