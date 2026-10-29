import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newerThan, parseHubResponse, parseLastModified } from '../src/abrCheck.ts'

test('parseHubResponse はタイトルと modified（ミリ秒）を読む', () => {
  const datasets = parseHubResponse({
    features: [{ properties: { title: '全国 町字マスター', modified: 1792793978000 } }],
  })
  assert.equal(datasets.length, 1)
  assert.equal(datasets[0]!.title, '全国 町字マスター')
  assert.equal(datasets[0]!.modified.toISOString(), '2026-10-23T22:19:38.000Z')
})

test('parseHubResponse は features の無い応答で例外を投げる', () => {
  assert.throws(() => parseHubResponse({ message: 'error' }))
  assert.throws(() => parseHubResponse(null))
})

test('newerThan は since より新しいものだけを新しい順に返す', () => {
  const d = (title: string, iso: string) => ({ title, modified: new Date(iso) })
  const since = new Date('2026-08-24T00:00:00+09:00')
  const result = newerThan([
    d('古い', '2025-08-10T00:00:00Z'),
    d('ちょうど', '2026-08-24T00:00:00+09:00'),
    d('新しい', '2026-09-01T00:00:00Z'),
    d('もっと新しい', '2026-10-24T00:00:00Z'),
  ], since)
  assert.deepEqual(result.map((x) => x.title), ['もっと新しい', '新しい'])
})

test('parseLastModified は Last-Modified の日時を読み、無いか読めなければ例外を投げる', () => {
  assert.equal(parseLastModified('Thu, 29 Oct 2026 01:14:16 GMT').toISOString(), '2026-10-29T01:14:16.000Z')
  assert.throws(() => parseLastModified(null))
  assert.throws(() => parseLastModified('yesterday'))
})
