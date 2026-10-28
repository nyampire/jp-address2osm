import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'

const PAGE_FILES: Record<string, string> = {
  '/': 'index.html',
  '/guide': 'guide.html',
  '/data': 'data.html',
  '/api': 'api.html',
}

export function isPagePath(urlPath: string): boolean {
  return Object.hasOwn(PAGE_FILES, urlPath)
}

// 住所データの索引（<base>.json）の meta.updated（UNIX 秒）を日本時間の日付にする
export function readDataDate(apiBasePath: string): string {
  try {
    const index = JSON.parse(fs.readFileSync(`${apiBasePath}.json`, 'utf8')) as { meta?: { updated?: unknown } }
    const updated = index?.meta?.updated
    if (typeof updated !== 'number' || !Number.isFinite(updated)) return '不明'
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(updated * 1000))
  } catch {
    return '不明'
  }
}

export type PageRendererOptions = {
  publicDir: string
  apiDocPath: string
  dataDate: string
}

// ファイルは要求ごとに読む。読めなければ投げる（呼び出し側が 500 にする）
export function createPageRenderer(options: PageRendererOptions): (path: string) => Promise<string | null> {
  const read = (file: string) => fs.promises.readFile(file, 'utf8')
  const partial = (name: string) => read(path.join(options.publicDir, 'partials', name))

  return async (urlPath) => {
    const file = isPagePath(urlPath) ? PAGE_FILES[urlPath] : undefined
    if (!file) return null
    let html = await read(path.join(options.publicDir, file))
    // 置換文字列に $ が含まれても解釈されないよう、関数で返す
    const replace = (marker: string, text: string) => { html = html.replaceAll(marker, () => text) }
    if (html.includes('<!-- include:style -->')) replace('<!-- include:style -->', await partial('style.html'))
    if (html.includes('<!-- include:header -->')) replace('<!-- include:header -->', await partial('header.html'))
    if (html.includes('<!-- include:footer -->')) replace('<!-- include:footer -->', await partial('footer.html'))
    if (html.includes('<!-- include:api-doc -->')) {
      replace('<!-- include:api-doc -->', await marked.parse(await read(options.apiDocPath)))
    }
    replace('{{dataDate}}', options.dataDate)
    return html
  }
}
