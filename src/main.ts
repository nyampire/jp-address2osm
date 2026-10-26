import { fileURLToPath } from 'node:url'
import { createRateLimiter } from './rateLimit.ts'

const MAX_ADDRESS_LENGTH = 200
const HEAP_LIMIT_MB = 400
// これより小さいと worker が住所データを読み込む前に古い世代の上限に達し、起動できない
const MIN_HEAP_LIMIT_MB = 128

// 分割処理は worker（parseWorker.ts）で動かす。worker が起動してから落ちないよう、
// NJA_API_BASE はここで確かめる。applyApiBase は住所データの索引が無ければ投げる
const rawBase = process.env.NJA_API_BASE
if (!rawBase) {
  process.stderr.write('NJA_API_BASE が必要です（file:// かパス）\n')
  process.exit(1)
}
const { applyApiBase } = await import('../vendor/nja-osm-tags/src/apiBase.ts')
let apiBase: string | undefined
try {
  apiBase = applyApiBase()
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`)
  process.exit(1)
}
const { createParsePool } = await import('./parsePool.ts')
const { createServer } = await import('./server.ts')
const { createPageRenderer, readDataDate } = await import('./pages.ts')

const heapLimit = Number(process.env.WORKER_HEAP_LIMIT_MB ?? HEAP_LIMIT_MB)
const pool = createParsePool({
  workerUrl: new URL('./parseWorker.ts', import.meta.url),
  heapLimitMb: Number.isFinite(heapLimit) && heapLimit > 0 ? Math.max(heapLimit, MIN_HEAP_LIMIT_MB) : HEAP_LIMIT_MB,
  onReplace: (mb) => process.stderr.write(`parse worker replaced (heap ${Math.round(mb)}MB)\n`),
  onExit: () => process.stderr.write('parse worker exited\n'),
})

const limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 60)
const port = Number(process.env.PORT ?? 8787)

const server = createServer({
  parse: (address) => pool.parse(address),
  limiter: createRateLimiter({ limit: Number.isFinite(limit) && limit > 0 ? limit : 60, windowMs: 60_000 }),
  trustProxy: process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1',
  renderPage: createPageRenderer({
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    apiDocPath: fileURLToPath(new URL('../docs/api.md', import.meta.url)),
    dataDate: apiBase?.startsWith('file://') ? readDataDate(fileURLToPath(apiBase)) : '不明',
  }),
  maxAddressLength: MAX_ADDRESS_LENGTH,
})
server.listen(port, () => {
  process.stderr.write(`listening on :${port}\n`)
})
