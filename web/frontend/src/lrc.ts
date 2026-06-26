// 歌词数据模型：支持逐字（word-level）时间轴。
// - 增强型 LRC（行内 <mm:ss.xx> 标签，如网易 yrc / QQ qrc 转写）→ 真正的逐字卡拉OK，
//   每个字有独立的 start/end，被拖长的字其点亮扫描自然变慢。
// - 普通 LRC（仅行级时间）→ 整行作为一个片段在该行时长内平滑扫过，作为优雅降级。

export interface LrcWord {
  start: number // 秒
  end: number // 秒
  text: string
}

export interface LrcLine {
  time: number // 行开始（秒）
  end: number // 行结束（秒）
  text: string // 整行文本
  words: LrcWord[] // 逐字/逐词时间轴
  karaoke: boolean // 是否有真正的逐字时间（决定是否做扫描点亮）
}

const LINE_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TAG = /<(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?>/g

function toSec(min: string, sec: string, ms: string | undefined): number {
  return parseInt(min, 10) * 60 + parseInt(sec, 10) + (ms ? parseInt(ms.padEnd(3, '0'), 10) / 1000 : 0)
}

// 行尾留白（最后一行没有下一行可参考时给的默认时长，秒）
const TAIL = 6

export function parseLrc(lyric: string | null | undefined): LrcLine[] {
  if (!lyric) return []

  const raw: { time: number; text: string; words: LrcWord[]; karaoke: boolean }[] = []

  for (const line of lyric.split(/\r?\n/)) {
    LINE_TAG.lastIndex = 0
    const stamps = [...line.matchAll(LINE_TAG)]
    if (stamps.length === 0) continue

    const last = stamps[stamps.length - 1]
    const body = line.slice((last.index ?? 0) + last[0].length)
    const hasWords = WORD_TAG.test(body)
    WORD_TAG.lastIndex = 0

    for (const st of stamps) {
      const lineTime = toSec(st[1], st[2], st[3])

      if (hasWords) {
        const tokens = [...body.matchAll(WORD_TAG)]
        const words: LrcWord[] = []
        let text = ''
        for (let i = 0; i < tokens.length; i++) {
          const tk = tokens[i]
          const start = toSec(tk[1], tk[2], tk[3])
          const segStart = (tk.index ?? 0) + tk[0].length
          const segEnd = i + 1 < tokens.length ? (tokens[i + 1].index ?? body.length) : body.length
          const w = body.slice(segStart, segEnd)
          if (w === '') continue
          words.push({ start, end: start, text: w })
          text += w
        }
        raw.push({ time: lineTime, text, words, karaoke: words.length > 0 })
      } else {
        const text = body.replace(WORD_TAG, '').trim()
        const words: LrcWord[] = text ? [{ start: lineTime, end: lineTime, text }] : []
        raw.push({ time: lineTime, text, words, karaoke: false })
      }
    }
  }

  raw.sort((a, b) => a.time - b.time)

  // 回填每行 / 每字的结束时间（用下一项的开始时间）
  const lines: LrcLine[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const lineEnd = i + 1 < raw.length ? raw[i + 1].time : cur.time + TAIL
    for (let j = 0; j < cur.words.length; j++) {
      const next = j + 1 < cur.words.length ? cur.words[j + 1].start : lineEnd
      cur.words[j].end = Math.max(next, cur.words[j].start)
    }
    lines.push({ time: cur.time, end: lineEnd, text: cur.text, words: cur.words, karaoke: cur.karaoke })
  }
  return lines
}
