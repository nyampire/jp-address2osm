import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitBuilding } from '../src/building.ts'

test('建物名、階、部屋番号に分ける', () =>
  assert.deepEqual(splitBuilding('中村ビル3F 301号室'), { 'addr:housename': '中村ビル', 'addr:floor': '3', 'addr:unit': '301' }))
test('階の表記は F と 階 と全角を読む', () => {
  assert.deepEqual(splitBuilding('中村ビル３階'), { 'addr:housename': '中村ビル', 'addr:floor': '3' })
  assert.deepEqual(splitBuilding('中村ビル３Ｆ'), { 'addr:housename': '中村ビル', 'addr:floor': '3' })
})
test('階だけなら建物名を出さない', () => assert.deepEqual(splitBuilding('5F'), { 'addr:floor': '5' }))
test('部屋番号だけなら建物名を出さない', () => assert.deepEqual(splitBuilding('301号室'), { 'addr:unit': '301' }))
test('切り分けられないものは建物名に入れる', () =>
  assert.deepEqual(splitBuilding('東京ガーデンテラス紀尾井町 B1F'), { 'addr:housename': '東京ガーデンテラス紀尾井町 B1F' }))
test('空なら何も出さない', () => assert.deepEqual(splitBuilding('  '), {}))
test('地下の2桁階は途中の数字を階と読まない', () =>
  assert.deepEqual(splitBuilding('東京ビル B12F'), { 'addr:housename': '東京ビル B12F' }))
test('2桁の階は階として読む', () =>
  assert.deepEqual(splitBuilding('中村ビル12F'), { 'addr:housename': '中村ビル', 'addr:floor': '12' }))
