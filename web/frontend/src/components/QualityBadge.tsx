import type { QualityTier } from '../types'

/**
 * 音质角标：统一用紧凑的文字小标表示各档位（不再用图形 logo）。
 * Atmos / Hi-Res / SQ(无损) / HQ 各自配色，standard 档不渲染。
 */

const TIER_TEXT: Record<QualityTier, string> = {
  atmos: 'Atmos',
  hires: 'Hi-Res',
  lossless: 'SQ',
  high: 'HQ',
  standard: '',
}

export function QualityBadge({
  tier,
  label,
  detail,
  showHigh = true,
}: {
  tier?: QualityTier | null
  label?: string | null
  detail?: string | null
  showHigh?: boolean
}) {
  if (!tier || tier === 'standard') return null
  if (tier === 'high' && !showHigh) return null
  const title = [label, detail].filter(Boolean).join(' · ')
  return (
    <span className={`q-chip q-${tier}`} title={title || undefined}>
      {TIER_TEXT[tier]}
    </span>
  )
}
