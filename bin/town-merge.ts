// ABR の町字マスターの新旧を比べ、消えた町字のうち地番か住居表示の番号がまだ指している町字を、
// japanese-addresses-v2 のキャッシュに足し戻す。作り直しは書き換えたキャッシュを読む。
// 使い方:
//   node bin/town-merge.ts compare --archive <前の版のキャッシュの写し> --cache <cache> --report <json>
//   node bin/town-merge.ts apply   --archive <dir> --cache <cache> --report <json>
//   node bin/town-merge.ts verify  --out <out/api/ja> --report <json>
// 終了コード: compare は 0 確かめることなし、10 あり。verify は 0 すべてある、1 無いものがある。2 は失敗
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { cacheFileName, countRefs, diffTowns, insertTowns, townKey } from '../src/townMerge.ts'

const ABR = 'https://data.address-br.digital.go.jp/'
const url = {
  townAll: () => `${ABR}mt_town/mt_town_all.csv.zip`,
  townPref: (pref: string) => `${ABR}mt_town/pref/mt_town_pref${pref}.csv.zip`,
  townPos: (pref: string) => `${ABR}mt_town_pos/pref/mt_town_pos_pref${pref}.csv.zip`,
  parcel: (lgCode: string) => `${ABR}mt_parcel/city/mt_parcel_city${lgCode}.csv.zip`,
  rsdt: (pref: string) => `${ABR}mt_rsdtdsp_rsdt/pref/mt_rsdtdsp_rsdt_pref${pref}.csv.zip`,
}

type Removed = { key: string; pref: string; city: string; name: string; parcels: number; rsdt: number; restore: boolean; previouslyRestored: boolean }
type Added = { key: string; name: string; rsdtAddr: boolean; rsdtMissing: boolean }
type Report = { removed: Removed[]; added: Added[] }

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { archive: { type: 'string' }, cache: { type: 'string' }, report: { type: 'string' }, out: { type: 'string' } },
})

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

function need(name: 'archive' | 'cache' | 'report' | 'out'): string {
  return values[name] ?? fail(`--${name} がありません`)
}

function readZipCsv(file: string): string {
  return execFileSync('unzip', ['-p', file], { encoding: 'utf8', maxBuffer: 1 << 30 })
}

// 元の zip の中の名前のまま、CSV を1つだけ含む zip に書き直す
function writeZipCsv(file: string, csv: string): void {
  const entry = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n')[0]!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-merge-'))
  fs.writeFileSync(path.join(dir, entry), csv)
  execFileSync('zip', ['-X', '-j', '-q', path.join(dir, 'out.zip'), path.join(dir, entry)])
  fs.renameSync(path.join(dir, 'out.zip'), file)
  fs.rmSync(dir, { recursive: true })
}

// japanese-addresses-v2 と同じ名前でキャッシュに置く。404 なら null（地番マスターの無い市区町村がある）
async function ensure(cache: string, target: string): Promise<string | null> {
  const file = path.join(cache, 'files', cacheFileName(target))
  if (fs.existsSync(file)) return file
  const res = await fetch(target, { headers: { 'User-Agent': 'curl/8.7.1' }, signal: AbortSignal.timeout(600_000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

async function ensureCsv(cache: string, target: string): Promise<string> {
  const file = await ensure(cache, target)
  return file ? readZipCsv(file) : ''
}

function archived(archive: string, target: string): string {
  const file = path.join(archive, cacheFileName(target))
  if (!fs.existsSync(file)) fail(`保管場所に ${target} の写しがありません: ${file}`)
  return readZipCsv(file)
}

function columns(csv: string): (line: string, name: string) => string {
  const header = csv.slice(0, csv.indexOf('\n')).replace(/^﻿/, '').split(',')
  return (line, name) => line.split(',')[header.indexOf(name)] ?? ''
}

function uniqueByKey(lines: string[]): string[] {
  const seen = new Set<string>()
  return lines.filter((line) => !seen.has(townKey(line)) && seen.add(townKey(line)))
}

async function compare(): Promise<number> {
  const archive = need('archive'), cache = need('cache')
  const oldCsv = archived(archive, url.townAll())
  const newCsv = await ensureCsv(cache, url.townAll())
  if (newCsv === '') fail('新しい版の全国 町字マスターが取れません')
  const col = columns(newCsv)
  const city = (line: string) => col(line, 'county') + col(line, 'city') + col(line, 'ward')
  const name = (line: string) => col(line, 'pref') + city(line) + col(line, 'oaza_cho') + col(line, 'chome') + col(line, 'koaza')
  const { removed, added } = diffTowns(oldCsv, newCsv)
  const restoredFile = path.join(archive, 'abr-restored.json')
  const previously = new Set<string>(fs.existsSync(restoredFile) ? JSON.parse(fs.readFileSync(restoredFile, 'utf8')) : [])

  const report: Report = { removed: [], added: [] }
  for (const line of uniqueByKey(removed)) {
    const key = townKey(line), lgCode = line.slice(0, 6)
    const parcels = countRefs(await ensureCsv(cache, url.parcel(lgCode)), new Set([key])).get(key)!
    const rsdt = countRefs(await ensureCsv(cache, url.rsdt(lgCode.slice(0, 2))), new Set([key])).get(key)!
    report.removed.push({
      key, pref: col(line, 'pref'), city: city(line), name: name(line),
      parcels, rsdt, restore: parcels + rsdt > 0, previouslyRestored: previously.has(key),
    })
  }
  for (const line of uniqueByKey(added)) {
    const key = townKey(line), rsdtAddr = col(line, 'rsdt_addr_flg') === '1'
    const rsdtMissing = rsdtAddr && countRefs(await ensureCsv(cache, url.rsdt(line.slice(0, 2))), new Set([key])).get(key) === 0
    report.added.push({ key, name: name(line), rsdtAddr, rsdtMissing })
  }
  fs.writeFileSync(need('report'), JSON.stringify(report, null, 2) + '\n')

  for (const r of report.removed) {
    const action = r.restore ? '足し戻す' : r.previouslyRestored ? '外す（前回足し戻した）' : '足し戻さない'
    process.stdout.write(`消えた町字: ${r.name}（地番 ${r.parcels} 件、住居表示 ${r.rsdt} 件）→ ${action}\n`)
  }
  const missing = report.added.filter((a) => a.rsdtMissing)
  for (const a of missing) process.stdout.write(`住居マスターの無い町字: ${a.name}\n`)
  process.stdout.write(`消えた町字 ${report.removed.length} 件、足された町字 ${report.added.length} 件（うち住居マスターの無い町字 ${missing.length} 件）\n`)
  return report.removed.length > 0 || missing.length > 0 ? 10 : 0
}

// 同じキーの行がすでにあれば入れない。apply を2回行っても行が増えない
function merge(csv: string, lines: string[]): { csv: string; inserted: number } {
  const present = new Set(csv.split('\n').slice(1).map(townKey))
  const missing = lines.filter((line) => !present.has(townKey(line)))
  return { csv: insertTowns(csv, missing), inserted: missing.length }
}

async function apply(): Promise<number> {
  const archive = need('archive'), cache = need('cache')
  const report: Report = JSON.parse(fs.readFileSync(need('report'), 'utf8'))
  const keys = new Set(report.removed.filter((r) => r.restore).map((r) => r.key))
  const pick = (csv: string) => csv.split('\n').filter((line) => keys.has(townKey(line)))

  const targets = [url.townAll()]
  for (const pref of new Set([...keys].map((key) => key.slice(0, 2)))) targets.push(url.townPref(pref), url.townPos(pref))
  for (const target of targets) {
    const file = await ensure(cache, target)
    if (!file) fail(`${target} が取れません`)
    const merged = merge(readZipCsv(file), pick(archived(archive, target)))
    if (merged.inserted > 0) writeZipCsv(file, merged.csv)
    process.stdout.write(`${path.basename(file)}: ${merged.inserted} 行を足し戻した\n`)
  }
  fs.writeFileSync(path.join(cache, 'abr-restored.json'), JSON.stringify([...keys], null, 2) + '\n')
  return 0
}

function verify(): number {
  const out = need('out')
  const report: Report = JSON.parse(fs.readFileSync(need('report'), 'utf8'))
  let missing = 0
  for (const r of report.removed.filter((x) => x.restore)) {
    const file = path.join(out, r.pref, `${r.city}.json`)
    const data: { machiaza_id: string }[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).data : []
    const found = data.some((m) => m.machiaza_id === r.key.split('|')[1])
    if (!found) missing++
    process.stdout.write(`${found ? 'ある' : '無い'}: ${r.name}\n`)
  }
  return missing > 0 ? 1 : 0
}

try {
  const command = positionals[0]
  if (command === 'compare') process.exit(await compare())
  if (command === 'apply') process.exit(await apply())
  if (command === 'verify') process.exit(verify())
  fail('使い方: node bin/town-merge.ts compare|apply|verify ...')
} catch (e) {
  fail((e as Error).message)
}
