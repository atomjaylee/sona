import { useState } from 'react'
import { sourceLabel, sourceIconUrl } from '../source-label'

/** 来源徽章：展示各音乐源官方 logo；showLabel 时附中文名；logo 加载失败回退为中文名 */
export function SourceBadge({ source, showLabel = false }: { source?: string | null; showLabel?: boolean }) {
  const [ok, setOk] = useState(true)
  const url = sourceIconUrl(source)
  const label = sourceLabel(source)
  const hasLogo = !!url && ok
  const iconOnly = hasLogo && !showLabel
  return (
    <span className={`src-badge${iconOnly ? ' icon-only' : ''}`} title={label}>
      {hasLogo ? (
        <img src={url!} alt={label} className="src-logo" loading="lazy" onError={() => setOk(false)} />
      ) : null}
      {showLabel || !hasLogo ? <span className="src-name">{label}</span> : null}
    </span>
  )
}
