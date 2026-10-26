import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createParsePool } from '../src/parsePool.ts'

const FAKE = new URL('./fixtures/fakeWorker.ts', import.meta.url)

// 応答の message に worker の threadId を入れてあるので、どの worker が処理したかが分かる
const who = async (p: Promise<{ message: string }>) => (await p).message

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  assert.ok(cond())
}

const make = (extra: Partial<Parameters<typeof createParsePool>[0]> = {}) =>
  createParsePool({ workerUrl: FAKE, heapLimitMb: 100, ...extra })

test('worker の応答をそのまま返す', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  const r = await pool.parse('高知県')
  assert.equal(r.result, 'jukyo')
})

test('作り直しを頼まれるまでは同じ worker で処理する', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  assert.equal(await who(pool.parse('a')), await who(pool.parse('b')))
})

test('作り直しを頼まれたら、次の要求から新しい worker で処理する', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  const first = await who(pool.parse('heavy'))
  const next = await who(pool.parse('a'))
  assert.notEqual(first, next)
  assert.equal(pool.stats().replaced, 1)
})

test('作り直すときに onReplace に使用量を渡す', async (t) => {
  const seen: number[] = []
  const pool = make({ onReplace: (mb) => seen.push(mb) })
  t.after(() => pool.close())
  await pool.parse('heavy')
  assert.deepEqual(seen, [10_000])
})

test('作り直しの前に受けた要求は、古い worker が最後まで返す', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  const slow = pool.parse('slow:200')
  const heavy = pool.parse('heavy')
  const [s, h] = await Promise.all([who(slow), who(heavy)])
  assert.equal(s, h)
  assert.notEqual(await who(pool.parse('a')), s)
})

test('古い worker は抱えた要求を返し終えたら終了し、予定外の終了とは数えない', async (t) => {
  const exits: number[] = []
  const pool = make({ onExit: () => exits.push(1) })
  t.after(() => pool.close())
  await pool.parse('heavy')
  await until(() => pool.stats().exited === 1)
  assert.equal(exits.length, 0)
})

test('worker が落ちたら、その要求は失敗し、次の要求は新しい worker で処理する', async (t) => {
  const exits: number[] = []
  const pool = make({ onExit: () => exits.push(1) })
  t.after(() => pool.close())
  await assert.rejects(pool.parse('crash'), { message: 'parse worker stopped' })
  assert.equal(exits.length, 1)
  const r = await pool.parse('a')
  assert.equal(r.result, 'jukyo')
})

test('落ちた直後には worker を立てず、次の要求で立てる', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  await assert.rejects(pool.parse('crash'))
  assert.equal(pool.stats().workers, 0)
  await pool.parse('a')
  assert.equal(pool.stats().workers, 1)
})

test('捕まえない例外で落ちても、その要求は失敗し、次の要求は処理できる', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  await assert.rejects(pool.parse('uncaught'), { message: 'parse worker stopped' })
  assert.equal((await pool.parse('a')).result, 'jukyo')
})

test('期限までに返らなければ失敗し、その worker を止める', async (t) => {
  const pool = make({ requestTimeoutMs: 100 })
  t.after(() => pool.close())
  const stuck = await who(pool.parse('a'))
  await assert.rejects(pool.parse('hang'), { message: 'parse timed out' })
  assert.notEqual(await who(pool.parse('b')), stuck)
  await until(() => pool.stats().exited === 1)
})

test('処理に失敗した要求だけが失敗し、worker はそのまま使い続ける', async (t) => {
  const pool = make()
  t.after(() => pool.close())
  const before = await who(pool.parse('a'))
  await assert.rejects(pool.parse('throw'), { message: 'parse failed' })
  assert.equal(await who(pool.parse('b')), before)
})

test('close すると抱えた要求は失敗し、その後の要求も受け付けない', async () => {
  const pool = make()
  const pending = pool.parse('slow:500')
  await pool.close()
  await assert.rejects(pending)
  await assert.rejects(pool.parse('a'), { message: 'parse pool closed' })
})

// 本物の worker を住所データで動かす。住所データが無い環境では飛ばす
const base = process.env.NJA_API_BASE
test('本物の worker で住所を分ける', { skip: !base && 'NJA_API_BASE が無い' }, async (t) => {
  const pool = createParsePool({ workerUrl: new URL('../src/parseWorker.ts', import.meta.url), heapLimitMb: 400 })
  t.after(() => pool.close())
  const r = await pool.parse('高知県高知市北本町1-2-6')
  assert.equal(r.result, 'jukyo')
  assert.equal(r.candidates[0]?.tags['addr:housenumber'], '6')
})
