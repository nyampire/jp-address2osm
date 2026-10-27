import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse as parseYaml } from 'yaml'
import { parseAddress } from '../src/parse.ts'
import { createServer } from '../src/server.ts'
import { createRateLimiter } from '../src/rateLimit.ts'
import type { NormalizeResult, NumberJudgement } from '../vendor/nja-osm-tags/src/index.ts'

// docs/openapi.yaml を正として、例、docs/api.md、実際の応答がそれに合うかを確かめる
const specText = readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8')
const spec = parseYaml(specText)
const apiDoc = readFileSync(new URL('../docs/api.md', import.meta.url), 'utf8')

// OpenAPI の components は JSON Schema の語ではないので、$defs に移して参照を読み替える
const defs = JSON.parse(JSON.stringify(spec.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'))
const ajv = new Ajv2020({ strict: true, allErrors: true })
ajv.addSchema({ $id: 'openapi', $defs: defs })
function check(name: string, value: unknown) {
  const validate = ajv.getSchema(`openapi#/$defs/${name}`)
  assert.ok(validate, name)
  assert.ok(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`)
}

const parseOp = spec.paths['/api/v1/parse'].post
const okExamples = parseOp.responses['200'].content['application/json'].examples as Record<string, { value: unknown }>

test('OpenAPI 3.1 の定義で、servers は公開する URL', () => {
  assert.equal(spec.openapi, '3.1.0')
  assert.deepEqual(spec.servers, [{ url: 'https://address2osm.nyampire.info' }])
})

test('200 の例はすべて ParseResponse に合う', () => {
  assert.deepEqual(Object.keys(okExamples), ['jukyo', 'chiban', 'ambiguous', 'remainder', 'unresolved'])
  for (const example of Object.values(okExamples)) check('ParseResponse', example.value)
})

test('定義に無い値や、欠けた項目は通さない', () => {
  const validate = ajv.getSchema('openapi#/$defs/ParseResponse')!
  const base = okExamples.jukyo!.value as Record<string, any>
  assert.equal(validate({ ...base, result: 'unknown' }), false)
  assert.equal(validate({ ...base, segments: [{ value: 'x', role: 'street', tagged: true }] }), false)
  assert.equal(validate({ ...base, candidates: [{ ...base.candidates[0], kind: 'other' }] }), false)
  assert.equal(validate({ ...base, candidates: [{ ...base.candidates[0], guessed: false }] }), false)
  const { message: _, ...noMessage } = base
  assert.equal(validate(noMessage), false)
})

test('誤りの応答の例は ErrorResponse に合う', () => {
  for (const status of ['400', '413', '429']) {
    check('ErrorResponse', parseOp.responses[status].content['application/json'].example)
  }
  check('ErrorResponse', spec.components.responses.Internal.content['application/json'].example)
})

test('docs/api.md の応答の例は、定義の例と同じ', () => {
  const blocks = [...apiDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!))
  const responses = blocks.filter((b) => 'apiVersion' in b)
  assert.deepEqual(responses, Object.values(okExamples).map((e) => e.value))
  const errors = blocks.filter((b) => 'error' in b)
  assert.ok(errors.length > 0)
  for (const e of errors) check('ErrorResponse', e)
})

test('docs/api.md の role、result、kind、error.code の表は、定義の enum と同じ', () => {
  const schemas = spec.components.schemas
  const firstColumn = (heading: string) => {
    const section = apiDoc.split(heading)[1]!.split(/\n#{2,3} /)[0]!
    // 見出し行（| `role` | 内容 |）を除くため、区切り行より後だけを見る
    const body = section.split(/^\|---.*$/m)[1]!
    return [...body.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1])
  }
  assert.deepEqual(firstColumn('### `result`の値'), schemas.ResultKind.enum)
  assert.deepEqual(firstColumn('`role`の値は次のとおりです。'), schemas.SegmentRole.enum)
  assert.deepEqual(firstColumn('`kind`の値は次のとおりです。'), schemas.CandidateKind.enum)
  const codes = [...apiDoc.split('## 誤りの応答')[1]!.matchAll(/\| `([a-z_]+)` \|$/gm)].map((m) => m[1])
  assert.deepEqual(codes, schemas.ErrorResponse.properties.error.properties.code.enum)
})

// nja-osm-tags のテスト用の正規化結果を、判定の値ごとに通す
const cases = [
  ...JSON.parse(readFileSync(new URL('../vendor/nja-osm-tags/test/fixtures/cases.json', import.meta.url), 'utf8')).cases,
  ...JSON.parse(readFileSync(new URL('../vendor/nja-osm-tags/test/fixtures/chiban-cases.json', import.meta.url), 'utf8')).cases,
] as { label: string; input: string; result: NormalizeResult }[]
const judgements: NumberJudgement[] = ['', '地番', '不一致', '判定不能']

test('正規化の結果を分けた応答は、どれも ParseResponse に合う', async () => {
  const seen = new Set<string>()
  for (const c of cases) {
    for (const judgement of judgements) {
      const response = await parseAddress(c.input, {
        normalize: async () => c.result,
        judge: () => judgement,
        logFailure: () => {},
      })
      check('ParseResponse', response)
      seen.add(response.result)
    }
  }
  assert.deepEqual([...seen].sort(), ['ambiguous', 'chiban', 'jukyo', 'unresolved'])
})

const servers: Server[] = []
after(() => { for (const s of servers) s.close() })

test('サーバが返す誤りの本文は ErrorResponse に合う', async () => {
  const server = createServer({
    parse: async () => { throw new Error('boom') },
    limiter: createRateLimiter({ limit: 4, windowMs: 60000 }),
    trustProxy: false,
    renderPage: async () => null,
    readOpenApi: async () => specText,
    maxAddressLength: 200,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (body: string) => fetch(`${base}/api/v1/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

  const requests: [number, () => Promise<Response>][] = [
    [400, () => post('not json')],
    [413, () => post(JSON.stringify({ address: 'あ'.repeat(201) }))],
    [500, () => post(JSON.stringify({ address: '高知県' }))],
    [404, () => fetch(`${base}/nothing`)],
    [405, () => fetch(`${base}/api/v1/parse`)],
    [429, () => post('{}')],
  ]
  // 回数の制限は POST の4回で尽きるので、429 は最後に送る
  await post('{}')
  for (const [status, send] of requests) {
    const res = await send()
    assert.equal(res.status, status)
    check('ErrorResponse', await res.json())
  }

  const res = await fetch(`${base}/api/openapi.yaml`)
  assert.equal(await res.text(), specText)
})
