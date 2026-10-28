import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSmoke, toSmokeCase } from '../src/smokeCheck.ts'

test('toSmokeCase は result と addr:full を取り出す', () => {
  const response = {
    apiVersion: '1',
    result: 'jukyo',
    candidates: [{ kind: 'jukyo', tags: { 'addr:full': '高知県高知市本町五丁目1-45' } }],
  }
  assert.deepEqual(toSmokeCase('高知県高知市本町5-1-45', response), {
    address: '高知県高知市本町5-1-45',
    result: 'jukyo',
    full: '高知県高知市本町五丁目1-45',
  })
})

test('toSmokeCase は候補が無ければ full を null にする', () => {
  assert.deepEqual(toSmokeCase('x', { result: 'unresolved', candidates: [] }), { address: 'x', result: 'unresolved', full: null })
})

test('compareSmoke は同じなら空、result か full が違えばその住所を含む行を返す', () => {
  const a = { address: '住所A', result: 'jukyo', full: 'A' }
  const b = { address: '住所B', result: 'chiban', full: 'B' }
  assert.deepEqual(compareSmoke([a, b], [a, b]), [])
  const diffs = compareSmoke([a, b], [{ ...a, result: 'ambiguous' }, { ...b, full: 'B2' }])
  assert.equal(diffs.length, 2)
  assert.ok(diffs[0]!.includes('住所A'))
  assert.ok(diffs[1]!.includes('住所B'))
})

test('compareSmoke は片方にしか無い住所も違いとして返す', () => {
  const a = { address: '住所A', result: 'jukyo', full: 'A' }
  const b = { address: '住所B', result: 'chiban', full: 'B' }
  const diffs = compareSmoke([a], [b])
  assert.equal(diffs.length, 2)
  assert.ok(diffs.some((d) => d.includes('住所A')))
  assert.ok(diffs.some((d) => d.includes('住所B')))
})
