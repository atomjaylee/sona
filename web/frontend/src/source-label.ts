// 音乐源 → 中文名 + 本地 logo（public/sources/*.png，由各家官方 favicon 整理）
const SOURCE_META: Record<string, { label: string; icon: string }> = {
  MiguMusicClient: { label: '咪咕', icon: 'migu' },
  NeteaseMusicClient: { label: '网易云', icon: 'netease' },
  QQMusicClient: { label: 'QQ音乐', icon: 'qq' },
  KuwoMusicClient: { label: '酷我', icon: 'kuwo' },
  QianqianMusicClient: { label: '千千', icon: '' },
}

const base = import.meta.env.BASE_URL || '/'

export function sourceLabel(source?: string | null): string {
  if (!source) return '—'
  return SOURCE_META[source]?.label ?? source.replace('MusicClient', '')
}

export function sourceIconUrl(source?: string | null): string | null {
  if (!source) return null
  const icon = SOURCE_META[source]?.icon
  return icon ? `${base}sources/${icon}.png` : null
}
