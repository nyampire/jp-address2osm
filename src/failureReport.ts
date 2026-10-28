import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'

// FAILURE_LOG（failureLog.ts）が書いた記録を、期間で絞って集計する。
// logrotate で回った .1 や .2.gz も同じ週の行を含むので、まとめて渡せるようにする

export type FailureRecord = { time: string; address: string; reason: string }

export type FailureSummary = {
  total: number
  skipped: number
  byReason: Record<string, number>
  byPrefecture: [string, number][]
  byCity: [string, number][]
  repeated: { address: string; count: number }[]
  addresses: string[]
}

const UNKNOWN = '（不明）'

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

// 郡の町村を先に見る。政令市は「市」で止め、区までは取らない
const CITY_PATTERNS = [/^(.+?郡.+?[町村])/, /^(.+?市)/, /^(.+?[区町村])/]

// 無いファイルは飛ばす。回る前の週は .1 や .2.gz がまだ無い
function readText(path: string): string | undefined {
  let data: Buffer
  try {
    data = fs.readFileSync(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw e
  }
  return (path.endsWith('.gz') ? gunzipSync(data) : data).toString('utf8')
}

// since <= time < until の行を返す。読めない行は数だけ返し、空行は数えない
export function readFailureRecords(paths: string[], since: Date, until: Date): { records: FailureRecord[]; skipped: number } {
  const records: FailureRecord[] = []
  let skipped = 0
  for (const path of paths) {
    const text = readText(path)
    if (text === undefined) continue
    for (const raw of text.split('\n')) {
      if (raw.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        skipped++
        continue
      }
      const record = value as Partial<FailureRecord>
      const time = typeof record.time === 'string' ? Date.parse(record.time) : NaN
      if (Number.isNaN(time)) {
        skipped++
        continue
      }
      if (time < since.getTime() || time >= until.getTime()) continue
      records.push({ time: record.time!, address: String(record.address ?? ''), reason: String(record.reason ?? '') })
    }
  }
  return { records, skipped }
}

export function splitArea(address: string): { prefecture: string; city: string } {
  const text = address.trim()
  const prefecture = PREFECTURES.find((p) => text.startsWith(p))
  if (!prefecture) return { prefecture: UNKNOWN, city: UNKNOWN }
  const rest = text.slice(prefecture.length)
  for (const pattern of CITY_PATTERNS) {
    const m = pattern.exec(rest)
    if (m) return { prefecture, city: m[1]! }
  }
  return { prefecture, city: UNKNOWN }
}

function count(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1)
}

// 件数の多い順、同数は名前の順
function ranked(map: Map<string, number>): [string, number][] {
  return [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

export function summarizeFailures(records: FailureRecord[], skipped: number): FailureSummary {
  const byReason: Record<string, number> = {}
  const prefectures = new Map<string, number>()
  // 府中市のように同じ名前の市区町村が別の都道府県にあるので、都道府県を付けて数える
  const cities = new Map<string, number>()
  const addresses = new Map<string, number>()
  for (const r of records) {
    byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
    const { prefecture, city } = splitArea(r.address)
    count(prefectures, prefecture)
    count(cities, prefecture === UNKNOWN ? UNKNOWN : prefecture + city)
    count(addresses, r.address.trim())
  }
  return {
    total: records.length,
    skipped,
    byReason,
    byPrefecture: ranked(prefectures),
    byCity: ranked(cities),
    repeated: ranked(addresses).filter(([, n]) => n >= 2).map(([address, n]) => ({ address, count: n })),
    addresses: [...addresses.keys()].sort(),
  }
}
