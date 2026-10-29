// アドレス・ベース・レジストリのデータセットが、--since の後に更新されたかを調べ、JSON で出す。
// 検索の modified を変えずにファイルだけが差し替わることがあるので、全国 町字マスターのファイルの Last-Modified も調べる。
// --repo を渡すと、japanese-addresses-v2 の手元の clone が GitHub の最新かも調べる。
// 使い方: node bin/abr-check.ts --since <ISO 8601> [--repo <japanese-addresses-v2 の clone>]
// 終了コード: 0 更新なし、10 更新あり、2 調べられなかった
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { HUB_PAGE_LIMIT, TOWN_ALL_URL, hubSearchUrl, newerThan, parseHubResponse, parseLastModified, type AbrDataset } from '../src/abrCheck.ts'

const UPSTREAM = 'https://github.com/geolonia/japanese-addresses-v2'

const { values } = parseArgs({ options: { since: { type: 'string' }, repo: { type: 'string' } } })
const since = new Date(values.since ?? '')
if (Number.isNaN(since.getTime())) {
  process.stderr.write('使い方: node bin/abr-check.ts --since <ISO 8601> [--repo <dir>]\n')
  process.exit(2)
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

let datasets: AbrDataset[] = []
try {
  const res = await fetch(hubSearchUrl(), { headers: { 'User-Agent': 'curl/8.7.1' }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  datasets = parseHubResponse(await res.json())
} catch (e) {
  fail(`ABR の検索に失敗しました: ${(e as Error).message}`)
}

let townFileModified: Date
try {
  const res = await fetch(TOWN_ALL_URL, { method: 'HEAD', headers: { 'User-Agent': 'curl/8.7.1' }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  townFileModified = parseLastModified(res.headers.get('last-modified'))
} catch (e) {
  fail(`全国 町字マスターのファイルの確認に失敗しました: ${(e as Error).message}`)
}
const townFileUpdated = townFileModified.getTime() > since.getTime()

let scriptUpdated: boolean | null = null
if (values.repo) {
  try {
    const local = execFileSync('git', ['-C', values.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const remote = execFileSync('git', ['ls-remote', UPSTREAM, 'HEAD'], { encoding: 'utf8' }).split('\t')[0]!.trim()
    scriptUpdated = local !== remote
  } catch (e) {
    fail(`japanese-addresses-v2 の確認に失敗しました: ${(e as Error).message}`)
  }
}

const newer = newerThan(datasets, since)
process.stdout.write(JSON.stringify({
  since: since.toISOString(),
  datasets: newer.map((d) => ({ title: d.title, modified: d.modified.toISOString() })),
  // 1ページ分がすべて新しければ、ほかにも更新されたものがある
  truncated: newer.length === HUB_PAGE_LIMIT,
  townFile: { url: TOWN_ALL_URL, lastModified: townFileModified.toISOString(), updated: townFileUpdated },
  scriptUpdated,
}, null, 2) + '\n')
process.exit(newer.length > 0 || townFileUpdated || scriptUpdated ? 10 : 0)
