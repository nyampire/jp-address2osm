import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cacheFileName, countRefs, diffTowns, insertTowns, townKey } from '../src/townMerge.ts'

const HEADER = 'lg_code,machiaza_id,oaza_cho,rsdt_addr_flg'

test('townKey は先頭2列から lg_code と machiaza_id のキーを作る', () => {
  assert.equal(townKey('152188,0119000,村松,0'), '152188|0119000')
})

test('diffTowns は住居表示の有無だけ違う2行を消えた扱いにせず、旧版にしか無いキーの行をすべて返す', () => {
  const oldCsv = [
    HEADER,
    '152188,0119000,村松,0',
    '152188,0119000,村松,1',
    '152188,0120000,村松工業団地,0',
    '152188,0120000,村松工業団地,1',
  ].join('\n') + '\n'
  const newCsv = [
    HEADER,
    '152188,0120000,村松工業団地,1',
    '152188,0120000,村松工業団地,0',
    '152188,0196000,村松上町,1',
  ].join('\n') + '\n'
  assert.deepEqual(diffTowns(oldCsv, newCsv), {
    removed: ['152188,0119000,村松,0', '152188,0119000,村松,1'],
    added: ['152188,0196000,村松上町,1'],
  })
})

test('countRefs はキーを指す行だけを数え、指す行の無いキーは 0 にする', () => {
  const parcels = [
    'lg_code,machiaza_id,prc_id',
    '152188,0119000,000001',
    '152188,0119000,000002',
    '152188,0019000,000001',
  ].join('\n') + '\n'
  const counts = countRefs(parcels, new Set(['152188|0119000', '152188|0196000']))
  assert.deepEqual([...counts.entries()], [['152188|0119000', 2], ['152188|0196000', 0]])
})

test('insertTowns は同じ lg_code の行の後ろに入れる', () => {
  const csv = [HEADER, '152188,0118000,a,0', '152188,0120000,b,0', '152196,0001000,c,0'].join('\n') + '\n'
  assert.equal(
    insertTowns(csv, ['152188,0119000,村松,0']),
    [HEADER, '152188,0118000,a,0', '152188,0120000,b,0', '152188,0119000,村松,0', '152196,0001000,c,0'].join('\n') + '\n',
  )
})

test('insertTowns は同じ lg_code が無ければ、より大きい lg_code の前に入れ、どれより大きければ末尾に入れる', () => {
  const csv = [HEADER, '152081,0001000,a,0', '152196,0001000,c,0'].join('\n') + '\n'
  assert.equal(
    insertTowns(csv, ['152188,0119000,村松,0', '152234,0001000,z,0']),
    [HEADER, '152081,0001000,a,0', '152188,0119000,村松,0', '152196,0001000,c,0', '152234,0001000,z,0'].join('\n') + '\n',
  )
})

test('cacheFileName は japanese-addresses-v2 のキャッシュの名前にする', () => {
  assert.equal(
    cacheFileName('https://data.address-br.digital.go.jp/mt_town/mt_town_all.csv.zip'),
    'https___data_address_br_digital_go_jp_mt_town_mt_town_all_csv_zip',
  )
})
