import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseAddress } from '../src/parse.ts'
import type { ParseDeps } from '../src/parse.ts'
import type { NormalizeResult, NumberJudgement, OsmTags } from '../vendor/nja-osm-tags/src/index.ts'

const fixtures = JSON.parse(readFileSync(new URL('../vendor/nja-osm-tags/test/fixtures/cases.json', import.meta.url), 'utf8'))
const chibanFixtures = JSON.parse(readFileSync(new URL('../vendor/nja-osm-tags/test/fixtures/chiban-cases.json', import.meta.url), 'utf8'))
const byLabel = (label: string): NormalizeResult => fixtures.cases.find((c: { label: string }) => c.label === label).result

type Setup = {
  result?: NormalizeResult
  // level 3 で返す結果。省略すると通常と同じ結果を返す
  town?: NormalizeResult
  townThrows?: boolean
  judgement?: NumberJudgement
  throws?: boolean
}

function setup(opts: Setup) {
  const normalized: string[] = []
  const townCalls: string[] = []
  const judged: OsmTags[] = []
  const logged: { address: string; reason: string }[] = []
  const deps: ParseDeps = {
    normalize: async (s, options) => {
      if (options?.level === 3) {
        townCalls.push(s)
        if (opts.townThrows) throw new Error('boom')
        return opts.town ?? opts.result!
      }
      normalized.push(s)
      if (opts.throws) throw new Error('boom')
      return opts.result!
    },
    judge: (tags) => { judged.push(tags); return opts.judgement ?? '' },
    logFailure: (e) => { logged.push(e) },
  }
  return { deps, normalized, townCalls, judged, logged }
}

// 結果の other だけを差し替えた複製
const withOther = (r: NormalizeResult, other: string): NormalizeResult => ({ ...structuredClone(r), other })
const fullOf = (r: { candidates: { tags: Record<string, string> }[] }) => r.candidates[0]!.tags['addr:full']

test('照合済みの住所では judge を呼ばない', async () => {
  const s = setup({ result: byLabel('verified/丁目なし') })
  const r = await parseAddress('東京都千代田区紀尾井町1-3', s.deps)
  assert.equal(r.result, 'jukyo')
  assert.equal(s.judged.length, 0)
})

test('推定の番地では judge を1回呼び、その結果で候補が決まる', async () => {
  const s = setup({ result: byLabel('inferred/2要素'), judgement: '判定不能' })
  const r = await parseAddress('東京都千代田区丸の内二丁目7-2', s.deps)
  assert.equal(s.judged.length, 1)
  assert.equal(r.result, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo', 'chiban'])
})

test('町字を特定できなければ unresolved を返し、入力の住所を記録する', async () => {
  const s = setup({ result: byLabel('machiaza-unresolved') })
  const r = await parseAddress('神奈川県横浜市旭区二俣川', s.deps)
  assert.equal(r.result, 'unresolved')
  assert.deepEqual(s.logged, [{ address: '神奈川県横浜市旭区二俣川', reason: 'machiaza-unresolved' }])
})

test('正規化が投げたら unresolved を返し、normalize-error で記録する', async () => {
  const s = setup({ throws: true })
  const r = await parseAddress('〒100-0001 東京都千代田区千代田1-1', s.deps)
  assert.equal(r.result, 'unresolved')
  assert.deepEqual(r.segments, [{ value: '100-0001', role: 'postcode', tagged: false }])
  assert.deepEqual(r.candidates, [])
  assert.equal(s.logged.length, 1)
  assert.equal(s.logged[0]!.reason, 'normalize-error')
})

test('分けられた住所は記録しない', async () => {
  const s = setup({ result: byLabel('verified/丁目なし') })
  await parseAddress('東京都千代田区紀尾井町1-3', s.deps)
  assert.equal(s.logged.length, 0)
})

test('郵便番号だけの入力は正規化を呼ばず、segments に郵便番号だけを返す', async () => {
  const s = setup({ result: byLabel('verified/丁目なし') })
  const r = await parseAddress('〒100-0001', s.deps)
  assert.equal(s.normalized.length, 0)
  assert.equal(r.result, 'unresolved')
  assert.deepEqual(r.segments, [{ value: '100-0001', role: 'postcode', tagged: false }])
  assert.deepEqual(r.candidates, [])
  assert.equal(s.logged[0]!.reason, 'empty')
})

test('地番の住所では metadata.chiban の番号が chiban の区切りになり、記録しない', async () => {
  const c = chibanFixtures.cases[0]
  const s = setup({ result: c.result })
  const r = await parseAddress(c.input, s.deps)
  assert.equal(r.result, 'chiban')
  assert.equal(r.segments.find((x) => x.role === 'chiban')?.value, '0-0-0')
  assert.equal(s.logged.length, 0)
})

test('地番の番号は prc_num1 から prc_num3 の順に、空のものを除いてつなぐ', async () => {
  // フィクスチャの地番は伏せ字の0なので、値の違う番号で結合の順を確かめる
  const c = structuredClone(chibanFixtures.cases[0])
  c.result.metadata.chiban = { ...c.result.metadata.chiban, prc_num1: '225', prc_num2: '', prc_num3: '7' }
  const s = setup({ result: c.result })
  const r = await parseAddress(c.input, s.deps)
  assert.equal(r.segments.find((x) => x.role === 'chiban')?.value, '225-7')
})

test('町字までの段階の other を townOther に使う（地番）', async () => {
  const c = structuredClone(chibanFixtures.cases[0])
  c.result.metadata.chiban = { ...c.result.metadata.chiban, prc_num1: '225', prc_num2: '', prc_num3: '7' }
  const s = setup({ result: c.result, town: withOther(c.result, '225-7') })
  const r = await parseAddress(c.input, s.deps)
  assert.equal(r.result, 'chiban')
  assert.deepEqual(s.townCalls, ['北海道北斗市開発225番地7'])
  assert.equal(fullOf(r), '北海道北斗市開発225-7')
})

test('地番のフィクスチャの addr:full は、町字の値と level 3 の番地を並べた文字列になる', async () => {
  const c = chibanFixtures.cases[0]
  const s = setup({ result: c.result, town: withOther(c.result, '225-7 ABCビル 5F') })
  const r = await parseAddress(c.input, s.deps)
  const t = r.candidates[0]!.tags
  assert.equal(t['addr:full'], '北海道北斗市開発225-7 ABCビル 5F')
  // 台帳の地番の値（伏せ字の 0-0-0）はタグにも候補の建物名にも入らない
  assert.equal(JSON.stringify([t, r.candidates[0]!.optionalTags]).includes('0-0-0'), false)
})

test('照合済みの住居表示は other が空でも、addr:full の末尾に level 3 の街区と住居番号が付く', async () => {
  const v = byLabel('verified/丁目なし')
  const s = setup({ result: v, town: withOther(v, '1-3 東京ガーデンテラス紀尾井町 5F') })
  const r = await parseAddress('東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町 5F', s.deps)
  assert.equal(r.result, 'jukyo')
  assert.equal(fullOf(r), '東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町 5F')
})

test('町字までの段階が違う町字を選んだら townOther を使わない', async () => {
  const c = structuredClone(chibanFixtures.cases[0])
  c.result.metadata.chiban = { ...c.result.metadata.chiban, prc_num1: '225', prc_num2: '', prc_num3: '7' }
  const other = withOther(c.result, '99-9')
  other.metadata!.machiAza!.machiaza_id = '0009000'
  const s = setup({ result: withOther(c.result, '8-8'), town: other })
  const r = await parseAddress(c.input, s.deps)
  assert.equal(s.townCalls.length, 1)
  assert.equal(fullOf(r), '北海道北斗市開発8-8')
})

test('町字までの段階が投げても応答を返し、記録しない', async () => {
  const v = byLabel('verified/残余あり')
  const s = setup({ result: v, townThrows: true })
  const r = await parseAddress('東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町', s.deps)
  assert.equal(s.townCalls.length, 1)
  assert.equal(r.result, 'jukyo')
  assert.equal(fullOf(r), '東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町 5F')
  assert.equal(s.logged.length, 0)
})

test('照合済みの住居表示で町字までの段階が違う町字を選んでも、addr:full に番地が入る', async () => {
  const v = byLabel('verified/残余あり')
  const other = withOther(v, '99-9')
  other.metadata!.machiAza!.machiaza_id = '0009000'
  const s = setup({ result: v, town: other })
  const r = await parseAddress('東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町', s.deps)
  assert.equal(s.townCalls.length, 1)
  assert.equal(fullOf(r), '東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町 5F')
})

test('郵便番号付きの入力で addr:full に郵便番号が入らない', async () => {
  const v = byLabel('verified/丁目なし')
  const s = setup({ result: v, town: withOther(v, '1-3') })
  const r = await parseAddress('〒102-0094 東京都千代田区紀尾井町1-3', s.deps)
  assert.deepEqual(s.townCalls, ['東京都千代田区紀尾井町1-3'])
  assert.equal(fullOf(r), '東京都千代田区紀尾井町1-3')
  assert.equal(r.segments[0]!.role, 'postcode')
})

test('分けられない住所では町字までの段階を呼ばない', async () => {
  const s = setup({ result: byLabel('machiaza-unresolved') })
  await parseAddress('神奈川県横浜市旭区二俣川', s.deps)
  assert.equal(s.townCalls.length, 0)
})
