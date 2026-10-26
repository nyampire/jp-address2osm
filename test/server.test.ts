import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createServer } from '../src/server.ts'
import { createRateLimiter } from '../src/rateLimit.ts'
import type { ParseResponse } from '../src/types.ts'

const fixed: ParseResponse = { apiVersion: '1', result: 'jukyo', message: 'ok', segments: [], candidates: [] }
const renderPage = async (path: string) =>
  path === '/' || path === '/guide' ? `<!doctype html><title>${path}</title>` : null

const servers: Server[] = []
let calls = 0

async function start(opts: { limit?: number; trustProxy?: boolean; parse?: () => Promise<ParseResponse> } = {}) {
  const server = createServer({
    parse: opts.parse ?? (async () => { calls++; return fixed }),
    limiter: createRateLimiter({ limit: opts.limit ?? 1000, windowMs: 60000 }),
    trustProxy: opts.trustProxy ?? false,
    renderPage,
    maxAddressLength: 200,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

after(() => { for (const s of servers) s.close() })
before(() => { calls = 0 })

const post = (base: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/v1/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })

test('正しい本文は 200 で ParseResponse', async () => {
  const base = await start()
  const res = await post(base, JSON.stringify({ address: '高知県高知市北本町' }))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(await res.json(), fixed)
})

for (const [name, body] of [
  ['JSONでない', 'not json'],
  ['address が無い', '{}'],
  ['address が文字列でない', '{"address":1}'],
  ['address が空白のみ', '{"address":"  　 "}'],
] as const) {
  test(`${name}は 400 bad_request`, async () => {
    const base = await start()
    const res = await post(base, body)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as any).error.code, 'bad_request')
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })
}

test('address が200文字を超えたら 413 too_long', async () => {
  const base = await start()
  const res = await post(base, JSON.stringify({ address: 'あ'.repeat(201) }))
  assert.equal(res.status, 413)
  assert.equal(((await res.json()) as any).error.code, 'too_long')
})

test('200文字ちょうどは通る', async () => {
  const base = await start()
  const res = await post(base, JSON.stringify({ address: 'あ'.repeat(200) }))
  assert.equal(res.status, 200)
})

test('8KB を超える本文は parse を呼ばずに 413', async () => {
  const before = calls
  const base = await start()
  const res = await post(base, JSON.stringify({ address: 'a', pad: 'x'.repeat(9000) }))
  assert.equal(res.status, 413)
  assert.equal(((await res.json()) as any).error.code, 'too_long')
  assert.equal(calls, before)
})

test('回数の制限を超えたら 429 と Retry-After', async () => {
  const base = await start({ limit: 1 })
  assert.equal((await post(base, '{"address":"a"}')).status, 200)
  const res = await post(base, '{"address":"a"}')
  assert.equal(res.status, 429)
  assert.equal(((await res.json()) as any).error.code, 'rate_limited')
  assert.ok(Number(res.headers.get('retry-after')) >= 1)
})

test('OPTIONS は 204 と CORS ヘッダ', async () => {
  const base = await start()
  const res = await fetch(`${base}/api/v1/parse`, { method: 'OPTIONS' })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  assert.equal(res.headers.get('access-control-allow-headers'), 'Content-Type')
})

test('GET /api/v1/parse?address=... は 405 で、parse を呼ばない', async () => {
  const before = calls
  const base = await start()
  const res = await fetch(`${base}/api/v1/parse?address=x`)
  assert.equal(res.status, 405)
  assert.equal(res.headers.get('allow'), 'POST, OPTIONS')
  assert.equal(((await res.json()) as any).error.code, 'method_not_allowed')
  assert.equal(calls, before)
})

test('GET / は renderPage の結果を text/html で返す', async () => {
  const base = await start()
  const res = await fetch(`${base}/`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(await res.text(), /<title>\/<\/title>/)
})

test('ページが読めなければ 500 internal', async () => {
  const server = createServer({
    parse: async () => fixed,
    limiter: createRateLimiter({ limit: 10, windowMs: 1000 }),
    trustProxy: false,
    renderPage: async () => { throw new Error('/secret/path') },
    maxAddressLength: 200,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.equal((JSON.parse(text) as any).error.code, 'internal')
  assert.doesNotMatch(text, /secret/)
})

test('GET /guide は 200 の text/html', async () => {
  const base = await start()
  const res = await fetch(`${base}/guide`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(await res.text(), /<title>\/guide<\/title>/)
})

test('そのほかは 404 not_found', async () => {
  const base = await start()
  const res = await fetch(`${base}/nope`)
  assert.equal(res.status, 404)
  assert.equal(((await res.json()) as any).error.code, 'not_found')
})

test('parse が投げたら 500 internal で、例外の文面を返さない', async () => {
  const base = await start({ parse: async () => { throw new Error('秘密の住所') } })
  const res = await post(base, '{"address":"a"}')
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.equal(JSON.parse(text).error.code, 'internal')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.ok(!text.includes('秘密'))
})

test('trustProxy が偽なら X-Forwarded-For を変えても同じ送り元として数える', async () => {
  const base = await start({ limit: 1, trustProxy: false })
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '1.1.1.1' })).status, 200)
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '2.2.2.2' })).status, 429)
})

test('trustProxy が真なら X-Forwarded-For の右端（プロキシが足した値）ごとに数える', async () => {
  const base = await start({ limit: 1, trustProxy: true })
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' })).status, 200)
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '9.9.9.9, 2.2.2.2' })).status, 200)
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' })).status, 429)
})

test('trustProxy が真で左端（送り元が名乗った値）だけ違っても、右端が同じなら同じ送り元として数える', async () => {
  const base = await start({ limit: 1, trustProxy: true })
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '3.3.3.3, 8.8.8.8' })).status, 200)
  assert.equal((await post(base, '{"address":"a"}', { 'X-Forwarded-For': '4.4.4.4, 8.8.8.8' })).status, 429)
})

test('GET や OPTIONS は回数に数えない', async () => {
  const base = await start({ limit: 1 })
  await fetch(`${base}/`)
  await fetch(`${base}/api/v1/parse`, { method: 'OPTIONS' })
  await fetch(`${base}/api/v1/parse`)
  assert.equal((await post(base, '{"address":"a"}')).status, 200)
})
