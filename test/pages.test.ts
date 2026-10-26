import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPageRenderer, readDataDate } from '../src/pages.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pages-'))
  const publicDir = join(root, 'public')
  mkdirSync(join(publicDir, 'partials'), { recursive: true })
  writeFileSync(join(publicDir, 'partials', 'header.html'), '<header>HEADER-X</header>')
  writeFileSync(join(publicDir, 'partials', 'footer.html'), '<footer>FOOTER-X {{dataDate}}版</footer>')
  writeFileSync(join(publicDir, 'partials', 'style.html'), '<style>STYLE-X</style>')
  const head = '<head><!-- include:style --></head>'
  writeFileSync(join(publicDir, 'index.html'), `${head}<!-- include:header -->\n<main>top</main>\n<!-- include:footer -->`)
  writeFileSync(join(publicDir, 'guide.html'), `${head}<!-- include:header --><h1>使い方</h1><!-- include:footer -->`)
  writeFileSync(join(publicDir, 'data.html'), `${head}<!-- include:header --><h1>データ</h1><!-- include:footer -->`)
  writeFileSync(join(publicDir, 'api.html'), `${head}<!-- include:header --><article><!-- include:api-doc --></article><!-- include:footer -->`)
  const apiDocPath = join(root, 'api.md')
  writeFileSync(apiDocPath, '# 見出し\n\n本文')
  return { root, publicDir, apiDocPath }
}

test('meta.updated を日本時間の日付にする', () => {
  const { root } = fixture()
  mkdirSync(join(root, 'out', 'api'), { recursive: true })
  writeFileSync(join(root, 'out', 'api', 'ja.json'), '{"meta":{"updated":1787831879}}')
  assert.equal(readDataDate(join(root, 'out', 'api', 'ja')), '2026年8月27日')
})

test('meta.updated が無ければ 不明', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'a.json'), '{"meta":{}}')
  writeFileSync(join(root, 'b.json'), 'not json')
  assert.equal(readDataDate(join(root, 'a')), '不明')
  assert.equal(readDataDate(join(root, 'b')), '不明')
  assert.equal(readDataDate(join(root, 'missing')), '不明')
})

test('ヘッダ、フッタ、日付を差し込む', async () => {
  const { publicDir, apiDocPath } = fixture()
  const render = createPageRenderer({ publicDir, apiDocPath, dataDate: '2026年8月27日' })
  for (const path of ['/', '/guide', '/data']) {
    const html = await render(path)
    assert.ok(html)
    assert.match(html, /HEADER-X/)
    assert.match(html, /FOOTER-X 2026年8月27日版/)
    assert.doesNotMatch(html, /include:|\{\{dataDate\}\}/)
  }
})

test('共通のスタイルを差し込む', async () => {
  const { publicDir, apiDocPath } = fixture()
  const render = createPageRenderer({ publicDir, apiDocPath, dataDate: 'x' })
  for (const path of ['/', '/guide', '/data', '/api']) {
    const html = await render(path)
    assert.ok(html)
    assert.match(html, /<head><style>STYLE-X<\/style><\/head>/)
    assert.doesNotMatch(html, /include:/)
  }
})

test('/api は Markdown を HTML にして差し込む', async () => {
  const { publicDir, apiDocPath } = fixture()
  const render = createPageRenderer({ publicDir, apiDocPath, dataDate: 'x' })
  const html = await render('/api')
  assert.ok(html)
  assert.match(html, /<h1[^>]*>見出し<\/h1>/)
  assert.match(html, /HEADER-X/)
  assert.doesNotMatch(html, /include:/)
})

test('ファイルは要求ごとに読む', async () => {
  const { publicDir, apiDocPath } = fixture()
  const render = createPageRenderer({ publicDir, apiDocPath, dataDate: 'x' })
  writeFileSync(join(publicDir, 'guide.html'), '<p>変えた</p>')
  assert.equal(await render('/guide'), '<p>変えた</p>')
})

test('知らないパスは null', async () => {
  const { publicDir, apiDocPath } = fixture()
  const render = createPageRenderer({ publicDir, apiDocPath, dataDate: 'x' })
  assert.equal(await render('/nope'), null)
  assert.equal(await render('/index.html'), null)
})
