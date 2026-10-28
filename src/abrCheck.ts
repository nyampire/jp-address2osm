// アドレス・ベース・レジストリ（ABR）のデータセットが、住所データを作った後に更新されたかを調べる。
// 検索の URL と group は japanese-addresses-v2 の src/lib/hub.ts（buildSearchUrl）に合わせる

export type AbrDataset = { title: string; modified: Date }

const HUB_SEARCH_URL = 'https://dataset.address-br.digital.go.jp/api/search/v1/collections/all/items'
const HUB_GROUP_ID = '864dfb9be4ef483d864e886fa25e1c94'

// 応答の形が違うときに「更新なし」と取り違えないよう、features が無ければ投げる
export function parseHubResponse(json: unknown): AbrDataset[] {
  const features = (json as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) throw new Error('ABR の検索の応答に features がありません')
  return features.map((f) => {
    const p = (f as { properties?: { title?: unknown; modified?: unknown } }).properties
    if (typeof p?.title !== 'string' || typeof p.modified !== 'number') {
      throw new Error('ABR の検索の応答に title か modified がありません')
    }
    return { title: p.title, modified: new Date(p.modified) }
  })
}

export function newerThan(datasets: AbrDataset[], since: Date): AbrDataset[] {
  return datasets
    .filter((d) => d.modified.getTime() > since.getTime())
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

// 分類（全国、都道府県、市区町村）で絞ると、都道府県と市区町村は都道府県名まで指定しないと1件も返らない。
// 絞らずに「マスター」を更新の新しい順に1ページ取れば、最も新しいものが分かる
export const HUB_PAGE_LIMIT = 100

export function hubSearchUrl(): string {
  return `${HUB_SEARCH_URL}?`
    + `filter=((group IN (${HUB_GROUP_ID})))`
    + `&limit=${HUB_PAGE_LIMIT}`
    + `&q=${encodeURIComponent('マスター')}`
    + '&sortBy=-properties.modified'
}
