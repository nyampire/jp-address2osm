import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFailureRecords, splitArea, summarizeFailures } from '../src/failureReport.ts'

const line = (time: string, address: string, reason = 'machiaza-unresolved') => JSON.stringify({ time, address, reason })
const all = [new Date('2000-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z')] as const

function dir() {
  return mkdtempSync(join(tmpdir(), 'fr-'))
}

test('壊れた行と time の無い行は読み飛ばして数え、空行は数えない', () => {
  const path = join(dir(), 'failures.jsonl')
  writeFileSync(path, [
    line('2026-10-20T00:00:00Z', 'a'),
    '{',
    '',
    '{"address":"x"}',
    line('2026-10-21T00:00:00Z', 'b'),
  ].join('\n') + '\n')
  const { records, skipped } = readFailureRecords([path], ...all)
  assert.deepEqual(records.map((r) => r.address), ['a', 'b'])
  assert.equal(skipped, 2)
})

test('無いファイルは飛ばす', () => {
  const d = dir()
  const path = join(d, 'failures.jsonl')
  writeFileSync(path, line('2026-10-20T00:00:00Z', 'a') + '\n')
  const { records, skipped } = readFailureRecords([path, join(d, 'failures.jsonl.1'), join(d, 'failures.jsonl.2.gz')], ...all)
  assert.equal(records.length, 1)
  assert.equal(skipped, 0)
})

test('since ちょうどは含み、until ちょうどは含まない', () => {
  const path = join(dir(), 'failures.jsonl')
  writeFileSync(path, [
    line('2026-10-19T23:59:59Z', 'before'),
    line('2026-10-20T00:00:00Z', 'since'),
    line('2026-10-26T23:59:59Z', 'inside'),
    line('2026-10-27T00:00:00Z', 'until'),
  ].join('\n') + '\n')
  const { records } = readFailureRecords([path], new Date('2026-10-20T00:00:00Z'), new Date('2026-10-27T00:00:00Z'))
  assert.deepEqual(records.map((r) => r.address), ['since', 'inside'])
})

test('.1 と .2.gz の行も読む', () => {
  const d = dir()
  writeFileSync(join(d, 'failures.jsonl'), line('2026-10-22T00:00:00Z', 'now') + '\n')
  writeFileSync(join(d, 'failures.jsonl.1'), line('2026-10-21T00:00:00Z', 'one') + '\n')
  writeFileSync(join(d, 'failures.jsonl.2.gz'), gzipSync(line('2026-10-20T00:00:00Z', 'two') + '\n'))
  const paths = ['failures.jsonl', 'failures.jsonl.1', 'failures.jsonl.2.gz'].map((f) => join(d, f))
  const { records } = readFailureRecords(paths, ...all)
  assert.deepEqual(records.map((r) => r.address).sort(), ['now', 'one', 'two'])
})

test('splitArea は都道府県と市区町村を分ける', () => {
  assert.deepEqual(splitArea('東京都千代田区霞が関1-3-1'), { prefecture: '東京都', city: '千代田区' })
  assert.deepEqual(splitArea('北海道札幌市中央区北1条西2丁目'), { prefecture: '北海道', city: '札幌市' })
  assert.deepEqual(splitArea('長野県北安曇郡白馬村北城'), { prefecture: '長野県', city: '北安曇郡白馬村' })
  assert.deepEqual(splitArea('  大阪府大阪市北区梅田'), { prefecture: '大阪府', city: '大阪市' })
  assert.deepEqual(splitArea('霞が関1-3-1'), { prefecture: '（不明）', city: '（不明）' })
  assert.deepEqual(splitArea(''), { prefecture: '（不明）', city: '（不明）' })
})

test('summarizeFailures は件数の多い順に並べ、2回以上の住所を repeated に出す', () => {
  const t = '2026-10-20T00:00:00Z'
  const summary = summarizeFailures([
    { time: t, address: '東京都千代田区あ', reason: 'machiaza-unresolved' },
    { time: t, address: '東京都千代田区あ ', reason: 'machiaza-unresolved' },
    { time: t, address: '東京都港区い', reason: 'normalize-error' },
    { time: t, address: '大阪府大阪市う', reason: 'machiaza-unresolved' },
    { time: t, address: '', reason: 'empty' },
  ], 1)
  assert.equal(summary.total, 5)
  assert.equal(summary.skipped, 1)
  assert.deepEqual(summary.byReason, { 'machiaza-unresolved': 3, 'normalize-error': 1, empty: 1 })
  assert.deepEqual(summary.byPrefecture, [['東京都', 3], ['大阪府', 1], ['（不明）', 1]])
  assert.deepEqual(summary.byCity, [['東京都千代田区', 2], ['大阪府大阪市', 1], ['東京都港区', 1], ['（不明）', 1]])
  assert.deepEqual(summary.repeated, [{ address: '東京都千代田区あ', count: 2 }])
  assert.deepEqual(summary.addresses, ['', '大阪府大阪市う', '東京都千代田区あ', '東京都港区い'])
})
