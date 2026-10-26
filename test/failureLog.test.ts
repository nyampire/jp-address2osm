import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFailureLog } from '../src/failureLog.ts'

test('2件書くと2行のJSONになる', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fl-')), 'fail.jsonl')
  const log = createFailureLog(path)
  log({ address: '神奈川県横浜市旭区二俣川', reason: 'machiaza-unresolved' })
  log({ address: '', reason: 'empty' })
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
  assert.equal(lines.length, 2)
  const first = JSON.parse(lines[0]!)
  assert.equal(first.address, '神奈川県横浜市旭区二俣川')
  assert.equal(first.reason, 'machiaza-unresolved')
  assert.ok(!Number.isNaN(Date.parse(first.time)))
  assert.equal(JSON.parse(lines[1]!).reason, 'empty')
})

test('path が undefined や空文字なら何も書かない', (t) => {
  const spy = mock.method(fs, 'appendFileSync', () => {})
  t.after(() => spy.mock.restore())
  createFailureLog(undefined)({ address: 'x', reason: 'empty' })
  createFailureLog('')({ address: 'x', reason: 'empty' })
  assert.equal(spy.mock.callCount(), 0)
})

test('書き込みに失敗しても例外を投げず、住所を標準エラーに出さない', (t) => {
  const err = t.mock.method(process.stderr, 'write', () => true)
  const path = join(mkdtempSync(join(tmpdir(), 'fl-')), 'no-such-dir', 'fail.jsonl')
  assert.doesNotThrow(() => createFailureLog(path)({ address: '秘密の住所', reason: 'empty' }))
  assert.equal(err.mock.callCount(), 1)
  assert.equal(String(err.mock.calls[0]!.arguments[0]), 'failure log: write failed\n')
})
