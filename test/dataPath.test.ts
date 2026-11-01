import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pinDataPath } from '../src/dataPath.ts'

function releases(): { current: string; release: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'data-path-')))
  const release = join(root, 'releases', '2026-08-27')
  mkdirSync(join(release, 'ja'), { recursive: true })
  symlinkSync('releases/2026-08-27', join(root, 'current'))
  return { current: join(root, 'current'), release }
}

test('pinDataPath はパスの途中のリンクを、起動したときの行き先に置き換える', () => {
  const { current, release } = releases()
  assert.equal(pinDataPath(join(current, 'ja')), join(release, 'ja'))
})

test('pinDataPath は file:// の URL でもリンクを置き換え、パスで返す', () => {
  const { current, release } = releases()
  assert.equal(pinDataPath(pathToFileURL(join(current, 'ja')).href), join(release, 'ja'))
})

test('pinDataPath は http の URL と、無いパスをそのまま返す', () => {
  assert.equal(pinDataPath('https://example.com/ja'), 'https://example.com/ja')
  assert.equal(pinDataPath('/no/such/ja'), '/no/such/ja')
})
