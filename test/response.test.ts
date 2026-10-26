import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResponse } from '../src/response.ts'
import type { ConversionResult } from '../vendor/nja-osm-tags/src/index.ts'

const town = { 'addr:country': 'JP', 'addr:province': '高知県', 'addr:city': '四万十市', 'addr:neighbourhood': '中村一条通三丁目' }
const withNumber = { ...town, 'addr:block_number': '2', 'addr:housenumber': '23' }
const TOWN_KEYS = ['addr:province', 'addr:city', 'addr:neighbourhood']

test('判定不能は住居表示と地番の2候補を、この順で返す', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'inferred', extra: {} },
    other: '2-23', judgement: '判定不能' })
  assert.equal(r.result, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo', 'chiban'])
  assert.deepEqual(Object.keys(r.candidates[1]!.tags), [...TOWN_KEYS, 'addr:full'])
  assert.equal(r.candidates[1]!.note, '地番の「2-23」はタグにしません。')
  assert.deepEqual(r.segments.at(-1), { value: '2-23', role: 'number_undecided', tagged: true })
  assert.equal(r.message, '住居表示の住所と推測しました。ABRは中村一条通三丁目を住居表示の実施済みとしていますが、住居表示の台帳がなく、地番の台帳にも「2-23」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。')
})

test('不一致は2候補で、台帳に無い旨の説明', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'inferred', extra: {} },
    other: '2-23', judgement: '不一致' })
  assert.equal(r.result, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo', 'chiban'])
  assert.equal(r.message, '住居表示の住所と推測しました。ABRは中村一条通三丁目を住居表示の実施済みとしていますが、住居表示の台帳にも地番の台帳にも「2-23」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。')
})

test('verified は住居表示の1候補', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'verified', extra: {} }, other: '', judgement: '' })
  assert.equal(r.result, 'jukyo')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo'])
  assert.equal(r.message, '住居表示の住所です。住居表示の台帳に、中村一条通三丁目の2-23があります。')
})

test('verified では other が空でも番地の区切りをタグから作る', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'verified', extra: {} }, other: '', judgement: '' })
  assert.deepEqual(r.segments.slice(-2), [
    { value: '2', role: 'block_number', tagged: true },
    { value: '23', role: 'housenumber', tagged: true },
  ])
})

test('inferred で台帳に番地がある（空文字）なら住居表示', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'inferred', extra: {} }, other: '2-23', judgement: '' })
  assert.equal(r.result, 'jukyo')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo'])
  assert.deepEqual(Object.keys(r.candidates[0]!.tags), [...TOWN_KEYS, 'addr:block_number', 'addr:housenumber', 'addr:full'])
})

test('inferred で地番なら地番の1候補', () => {
  const r = buildResponse({ conversion: { tags: withNumber, numberSource: 'inferred', extra: {} }, other: '2-23', judgement: '地番' })
  assert.equal(r.result, 'chiban')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['chiban'])
  assert.equal(r.message, '地番の住所と判定しました。中村一条通三丁目の2-23は、住居表示の台帳に無く、地番の台帳にあります。番地はタグにしません。')
  assert.deepEqual(r.segments.at(-1), { value: '2-23', role: 'chiban', tagged: false })
})

test('rsdt-detail-missing は町字までの住居表示', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'rsdt-detail-missing', extra: {} },
    other: 'ビル', judgement: '' })
  assert.equal(r.result, 'jukyo')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo'])
  assert.deepEqual(Object.keys(r.candidates[0]!.tags), [...TOWN_KEYS, 'addr:full'])
  assert.equal(r.message, '住居表示の住所ですが、番地を読み取れませんでした。番地はタグにしません。')
  assert.deepEqual(r.segments.at(-1), { value: 'ビル', role: 'remainder', tagged: false })
})

test('chiban は地番の1候補で、番地の区切りの役割は chiban', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'chiban', extra: {} },
    other: '', chibanNumber: '12-3', judgement: '' })
  assert.equal(r.result, 'chiban')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['chiban'])
  assert.equal(r.message, '地番の住所です。地番の台帳に、中村一条通三丁目の12-3があります。番地はタグにしません。')
  assert.deepEqual(r.segments.at(-1), { value: '12-3', role: 'chiban', tagged: false })
  assert.equal(r.candidates[0]!.note, '地番の「12-3」はタグにしません。')
})

test('rsdt-not-implemented は地番の1候補', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'rsdt-not-implemented', extra: {} },
    other: '5-1', judgement: '' })
  assert.equal(r.result, 'chiban')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['chiban'])
  assert.equal(r.message, '地番の住所です。中村一条通三丁目は住居表示を実施していない町字です。番地はタグにしません。')
})

test('machiaza-from-mlit は町字までの town 候補で ambiguous', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'machiaza-from-mlit', extra: {} },
    other: '5', judgement: '' })
  assert.equal(r.result, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['town'])
  assert.equal(r.candidates[0]!.note, undefined)
  assert.equal(r.message, '住居表示か地番かを決められません。中村一条通三丁目は台帳に番地の明細が無い町字です。番地はタグにしません。')
})

test('machiaza-unresolved は候補なしで unresolved', () => {
  const r = buildResponse({ conversion: { tags: { 'addr:province': '高知県' }, numberSource: 'none', noNumberReason: 'machiaza-unresolved', extra: {} },
    other: '不明町1-2', judgement: '' })
  assert.equal(r.result, 'unresolved')
  assert.deepEqual(r.candidates, [])
  assert.equal(r.message, '町字を特定できず、住所を分けられませんでした。この住所は改善のために記録します。')
  assert.deepEqual(r.segments, [
    { value: '高知県', role: 'prefecture', tagged: false },
    { value: '不明町1-2', role: 'remainder', tagged: false },
  ])
})

const leaky: ConversionResult = {
  tags: { ...withNumber, note: '建物', fixme: '3-4', 'addr:suburb': '中央区' },
  numberSource: 'inferred', extra: { point: { lat: 33.1, lng: 133.2, level: 8 }, cityCode: 39 },
}

test('どの候補にも addr:country, note, fixme が無い', () => {
  for (const judgement of ['', '判定不能', '地番'] as const) {
    const r = buildResponse({ conversion: leaky, other: '2-23', judgement })
    for (const c of r.candidates) for (const k of ['addr:country', 'note', 'fixme']) assert.equal(k in c.tags, false)
  }
})

test('地番の候補には addr:block_number も addr:housenumber も無い', () => {
  const cases = [
    buildResponse({ conversion: { tags: withNumber, numberSource: 'none', noNumberReason: 'chiban', extra: {} }, other: '', chibanNumber: '2-23', judgement: '' }),
    buildResponse({ conversion: { tags: withNumber, numberSource: 'none', noNumberReason: 'rsdt-not-implemented', extra: {} }, other: '2-23', judgement: '' }),
    buildResponse({ conversion: leaky, other: '2-23', judgement: '地番' }),
    buildResponse({ conversion: leaky, other: '2-23', judgement: '不一致' }),
  ]
  for (const r of cases) for (const c of r.candidates.filter((c) => c.kind === 'chiban')) {
    assert.equal('addr:block_number' in c.tags, false)
    assert.equal('addr:housenumber' in c.tags, false)
  }
})

test('extra を応答に写さない', () => {
  const r = buildResponse({ conversion: leaky, other: '2-23', judgement: '判定不能' })
  assert.deepEqual(Object.keys(r).sort(), ['apiVersion', 'candidates', 'message', 'result', 'segments'])
  for (const c of r.candidates) assert.deepEqual(Object.keys(c).filter((k) => !['kind', 'tags', 'note', 'guessed', 'optionalTags'].includes(k)), [])
  assert.doesNotMatch(JSON.stringify(r), /"(lat|lng|level|point)"/)
})

test('郵便番号は先頭の区切りと各候補の先頭のタグになる', () => {
  const r = buildResponse({ postcode: '787-0012', conversion: { tags: withNumber, numberSource: 'inferred', extra: {} },
    other: '2-23', judgement: '判定不能' })
  assert.deepEqual(r.segments[0], { value: '787-0012', role: 'postcode', tagged: true })
  for (const c of r.candidates) assert.equal(Object.keys(c.tags)[0], 'addr:postcode')
})

test('区は ward、大字は quarter の区切りになり、順序は住所の順', () => {
  const r = buildResponse({ conversion: { tags: { 'addr:province': '高知県', 'addr:city': '高知市', 'addr:suburb': '中央区',
      'addr:quarter': '大字A', 'addr:neighbourhood': '町B', 'addr:block_number': '1', 'addr:housenumber': '2' }, numberSource: 'verified', extra: {} },
    other: '', judgement: '' })
  assert.deepEqual(r.segments.map((s) => s.role), ['prefecture', 'city', 'ward', 'quarter', 'neighbourhood', 'block_number', 'housenumber'])
})

test('1-2-6-301 ビル3F は extra_number と remainder に分かれる', () => {
  const r = buildResponse({ conversion: { tags: { ...town, 'addr:block_number': '1', 'addr:housenumber': '2' }, numberSource: 'inferred', extra: {} },
    other: '1-2-6-301 ビル3F', judgement: '' })
  assert.deepEqual(r.segments.slice(-4), [
    { value: '1', role: 'block_number', tagged: true },
    { value: '2', role: 'housenumber', tagged: true },
    { value: '6-301', role: 'extra_number', tagged: false },
    { value: 'ビル3F', role: 'remainder', tagged: false },
  ])
})

test('chibanNumber があれば番地の区切りの役割は chiban', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'chiban', extra: {} },
    other: 'ビル', chibanNumber: '7', judgement: '' })
  assert.equal(r.segments.find((s) => s.role === 'chiban')?.value, '7')
  assert.deepEqual(r.segments.at(-1), { value: 'ビル', role: 'remainder', tagged: false })
})

// addr:full、推測、建物名などの候補
const inferred = (neighbourhood: string, block: string, house: string): ConversionResult => ({
  tags: { ...town, 'addr:neighbourhood': neighbourhood, 'addr:block_number': block, 'addr:housenumber': house },
  numberSource: 'inferred', extra: {},
})
const chibanConv: ConversionResult = { tags: town, numberSource: 'none', noNumberReason: 'chiban', extra: {} }

test('addr:full は町字までの値、番地、建物名などをつなぐ', () => {
  const r = buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23 中村ビル3F 301号室',
    townOther: '2-23 中村ビル3F 301号室', judgement: '不一致' })
  for (const c of r.candidates) assert.equal(c.tags['addr:full'], '高知県四万十市中村一条通三丁目2-23 中村ビル3F 301号室')
  assert.equal(Object.keys(r.candidates[0]!.tags).at(-1), 'addr:full')
})

test('照合済みで townOther が無ければ、addr:full の番地をタグの街区と住居番号から作る', () => {
  const conv: ConversionResult = {
    tags: { 'addr:province': '東京都', 'addr:city': '千代田区', 'addr:neighbourhood': '紀尾井町', 'addr:block_number': '1', 'addr:housenumber': '3' },
    numberSource: 'verified', extra: {},
  }
  const r = buildResponse({ conversion: conv, other: '東京ガーデンテラス紀尾井町 5F', judgement: '' })
  assert.equal(r.candidates[0]!.tags['addr:full'], '東京都千代田区紀尾井町1-3 東京ガーデンテラス紀尾井町 5F')
})

test('地番の addr:full の番地は townOther から取り、台帳の値を使わない', () => {
  const r = buildResponse({ conversion: chibanConv, other: '', chibanNumber: '999-9', townOther: '225-7', judgement: '' })
  assert.match(r.candidates[0]!.tags['addr:full']!, /225-7$/)
  // 台帳の値はタグにしない。note と segments の表示は今のまま
  for (const c of r.candidates) assert.doesNotMatch(JSON.stringify([c.tags, c.optionalTags]), /999-9/)
  assert.equal(r.candidates[0]!.note, '地番の「999-9」はタグにしません。')
  assert.equal(r.segments.find((s) => s.role === 'chiban')?.value, '999-9')
})

test('地番で townOther が無ければ、addr:full に台帳の番地を入れない', () => {
  const r = buildResponse({ conversion: chibanConv, other: 'ABCビル', chibanNumber: '999-9', judgement: '' })
  assert.equal(r.candidates[0]!.tags['addr:full'], '高知県四万十市中村一条通三丁目 ABCビル')
})

test('郵便番号は addr:full に入れない', () => {
  const r = buildResponse({ postcode: '787-0012', conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '' })
  assert.equal(r.candidates[0]!.tags['addr:postcode'], '787-0012')
  assert.equal(r.candidates[0]!.tags['addr:full'], '高知県四万十市中村一条通三丁目2-23')
})

test('不一致は jukyo に guessed を付け、推測の文を返す', () => {
  const r = buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '不一致' })
  assert.equal(r.result, 'ambiguous')
  assert.deepEqual(r.candidates.map((c) => c.kind), ['jukyo', 'chiban'])
  assert.equal(r.candidates[0]!.guessed, true)
  assert.equal('guessed' in r.candidates[1]!, false)
  assert.equal(r.message, '住居表示の住所と推測しました。ABRは中村一条通三丁目を住居表示の実施済みとしていますが、住居表示の台帳にも地番の台帳にも「2-23」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。')
})

test('判定不能は推測の文の判定不能の版を返す', () => {
  const r = buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '判定不能' })
  assert.equal(r.candidates[0]!.guessed, true)
  assert.equal(r.message, '住居表示の住所と推測しました。ABRは中村一条通三丁目を住居表示の実施済みとしていますが、住居表示の台帳がなく、地番の台帳にも「2-23」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。')
})

test('照合済みの候補には guessed を付けない', () => {
  for (const r of [
    buildResponse({ conversion: { ...inferred('中村一条通三丁目', '2', '23'), numberSource: 'verified' }, other: '', judgement: '' }),
    buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '' }),
    buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '地番' }),
  ]) for (const c of r.candidates) assert.equal('guessed' in c, false)
})

test('建物名などはすべての候補の optionalTags に入り、tags には入らない', () => {
  const r = buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23 中村ビル3F 301号室',
    townOther: '2-23 中村ビル3F 301号室', judgement: '不一致' })
  for (const c of r.candidates) {
    assert.deepEqual(c.optionalTags, { 'addr:housename': '中村ビル', 'addr:floor': '3', 'addr:unit': '301' })
    for (const k of ['addr:housename', 'addr:floor', 'addr:unit']) assert.equal(k in c.tags, false)
  }
  const none = buildResponse({ conversion: inferred('中村一条通三丁目', '2', '23'), other: '2-23', judgement: '' })
  assert.equal('optionalTags' in none.candidates[0]!, false)
})

test('town 候補にも addr:full と optionalTags が付く', () => {
  const r = buildResponse({ conversion: { tags: town, numberSource: 'none', noNumberReason: 'machiaza-from-mlit', extra: {} },
    other: '5-6 ビル', judgement: '' })
  assert.equal(r.candidates[0]!.tags['addr:full'], '高知県四万十市中村一条通三丁目5-6 ビル')
  assert.deepEqual(r.candidates[0]!.optionalTags, { 'addr:housename': 'ビル' })
})

test('unresolved には addr:full も optionalTags も無い', () => {
  const r = buildResponse({ conversion: { tags: { 'addr:province': '高知県' }, numberSource: 'none', noNumberReason: 'machiaza-unresolved', extra: {} },
    other: '不明町1-2 ビル3F', judgement: '' })
  assert.deepEqual(r.candidates, [])
  assert.doesNotMatch(JSON.stringify(r), /addr:full|optionalTags/)
})
