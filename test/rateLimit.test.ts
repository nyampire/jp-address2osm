import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../src/rateLimit.ts'

test('上限までは ok、超えたら retryAfterSec が1以上', () => {
  let t = 1000
  const limit = createRateLimiter({ limit: 2, windowMs: 60000, now: () => t })
  assert.deepEqual(limit('a'), { ok: true })
  assert.deepEqual(limit('a'), { ok: true })
  const r = limit('a')
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.retryAfterSec >= 1)
})

test('窓を過ぎれば戻る', () => {
  let t = 0
  const limit = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
  assert.equal(limit('a').ok, true)
  assert.equal(limit('a').ok, false)
  t = 1000
  assert.equal(limit('a').ok, true)
})

test('鍵ごとに別に数える', () => {
  const limit = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 })
  assert.equal(limit('a').ok, true)
  assert.equal(limit('b').ok, true)
  assert.equal(limit('a').ok, false)
})
