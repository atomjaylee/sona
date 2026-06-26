// 专辑封面主题色提取 + 全局主题色 CSS 变量。
// 统一在这里取色，PlayerProvider 切歌时调用一次，歌词背景 / 全局背景 / UI 着色共用，避免重复取色。

export type RGB = [number, number, number] // 各分量 0..1

export const FALLBACK_PALETTE: RGB[] = [
  [0.36, 0.12, 0.5],
  [0.12, 0.3, 0.55],
  [0.5, 0.2, 0.35],
  [0.1, 0.4, 0.45],
  [0.25, 0.15, 0.45],
]

// 从封面取 5 个主色：缩到 48x48，4 位量化分桶取频次最高的若干色，提升饱和度
export function extractPalette(img: HTMLImageElement): RGB[] {
  try {
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 48
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return FALLBACK_PALETTE
    ctx.drawImage(img, 0, 0, 48, 48)
    const data = ctx.getImageData(0, 0, 48, 48).data
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      if (max < 24 || (max > 235 && min > 220)) continue // 跳过接近黑/白的像素
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
      e.r += r; e.g += g; e.b += b; e.n++
      buckets.set(key, e)
    }
    const arr = [...buckets.values()]
      .map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5)
    if (arr.length === 0) return FALLBACK_PALETTE
    const out: RGB[] = arr.map((e) => {
      const mean = (e.r + e.g + e.b) / 3
      const sat = 1.45
      const r = Math.min(255, mean + (e.r - mean) * sat)
      const g = Math.min(255, mean + (e.g - mean) * sat)
      const b = Math.min(255, mean + (e.b - mean) * sat)
      return [(r / 255) * 0.95, (g / 255) * 0.95, (b / 255) * 0.95]
    })
    while (out.length < 5) out.push(out[out.length % arr.length])
    return out
  } catch {
    return FALLBACK_PALETTE
  }
}
