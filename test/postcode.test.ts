import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPostcode } from '../src/postcode.ts'

test('先頭の〒付きを切り出す', () =>
  assert.deepEqual(extractPostcode('〒780-0870 高知県高知市本町'), { postcode: '780-0870', rest: '高知県高知市本町' }))
test('全角とハイフン無しも読む', () =>
  assert.deepEqual(extractPostcode('〒７８００８７０高知県'), { postcode: '780-0870', rest: '高知県' }))
test('〒無しは先頭の NNN-NNNN だけを読む', () =>
  assert.deepEqual(extractPostcode('780-0870 高知県'), { postcode: '780-0870', rest: '高知県' }))
test('〒無しの7桁の続き数字は郵便番号とみなさない', () =>
  assert.deepEqual(extractPostcode('7800870高知県'), { rest: '7800870高知県' }))
test('住所の途中の番地を郵便番号と読まない', () =>
  assert.deepEqual(extractPostcode('高知県高知市北本町1-2-6'), { rest: '高知県高知市北本町1-2-6' }))
test('〒は住所の後ろにあっても読む', () =>
  assert.deepEqual(extractPostcode('高知県高知市本町 〒780-0870'), { postcode: '780-0870', rest: '高知県高知市本町' }))
test('郵便番号だけなら rest は空', () =>
  assert.deepEqual(extractPostcode('〒780-0870'), { postcode: '780-0870', rest: '' }))
test('長音記号を壊さない', () =>
  assert.deepEqual(extractPostcode('〒780-0870 高知県高知市ハーバー町'), { postcode: '780-0870', rest: '高知県高知市ハーバー町' }))
test('途中の〒は前後の空白を1つにまとめる', () =>
  assert.deepEqual(extractPostcode('高知県  〒780-0870  高知市'), { postcode: '780-0870', rest: '高知県 高知市' }))
