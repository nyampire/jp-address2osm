// ABR の町字マスターの新旧を比べ、消えた町字の行を新しい版に足し戻す。
// ABR は廃止した町字を行ごと消すが、地番マスターはその町字を指したまま残ることがある（設計 E）。
// CSV は引用符を使わない ABR の形を前提に、行をそのまま扱う

export function townKey(line: string): string {
  const [lgCode, machiazaId] = line.split(',', 2)
  return `${lgCode}|${machiazaId}`
}

function dataLines(csv: string): string[] {
  return csv.split('\n').slice(1).filter((line) => line !== '')
}

// キーの同じ行が2行ある（住居表示の有無だけ違う）ことがあるので、行ではなくキーで比べる
export function diffTowns(oldCsv: string, newCsv: string): { removed: string[]; added: string[] } {
  const oldLines = dataLines(oldCsv)
  const newLines = dataLines(newCsv)
  const oldKeys = new Set(oldLines.map(townKey))
  const newKeys = new Set(newLines.map(townKey))
  return {
    removed: oldLines.filter((line) => !newKeys.has(townKey(line))),
    added: newLines.filter((line) => !oldKeys.has(townKey(line))),
  }
}

export function countRefs(csv: string, keys: Set<string>): Map<string, number> {
  const counts = new Map([...keys].map((key) => [key, 0]))
  for (const line of dataLines(csv)) {
    const key = townKey(line)
    const count = counts.get(key)
    if (count !== undefined) counts.set(key, count + 1)
  }
  return counts
}

// japanese-addresses-v2 の 02_make_machi_aza は lg_code の続きごとに市区町村の出力を分けるので、
// 同じ lg_code の並びを崩さないところに入れる
export function insertTowns(csv: string, lines: string[]): string {
  const [header, ...rows] = csv.split('\n').filter((line) => line !== '')
  const lgCode = (line: string) => line.split(',', 1)[0]!
  for (const line of lines) {
    const code = lgCode(line)
    let last = rows.length - 1
    while (last >= 0 && lgCode(rows[last]!) !== code) last--
    if (last >= 0) {
      rows.splice(last + 1, 0, line)
      continue
    }
    const next = rows.findIndex((row) => lgCode(row) > code)
    if (next >= 0) rows.splice(next, 0, line)
    else rows.push(line)
  }
  return [header, ...rows].join('\n') + '\n'
}

// japanese-addresses-v2 の src/lib/fetch_tools.ts の cacheKey に合わせる
export function cacheFileName(url: string): string {
  return url.replace(/[^a-zA-Z0-9]/g, '_')
}
