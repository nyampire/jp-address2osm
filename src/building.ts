// 末尾から順に部屋番号、階を剥がし、残りを建物名にする
// 階の数字の前が英字や数字のもの（B1F、B12F など）は地下階の表記として読むため、階とはみなさず建物名に残す。
// 数字を除外しないと B12F の途中の「2F」だけを階と読んでしまう
const UNIT = /(\d+)号室?$/
const FLOOR = /(?<![A-Za-z\d])(\d+)(?:F|階)$/i

export function splitBuilding(rest: string): { 'addr:housename'?: string; 'addr:floor'?: string; 'addr:unit'?: string } {
  let text = rest.normalize('NFKC').trim()
  const out: { 'addr:housename'?: string; 'addr:floor'?: string; 'addr:unit'?: string } = {}

  const unit = UNIT.exec(text)
  if (unit) {
    out['addr:unit'] = unit[1]
    text = text.slice(0, unit.index).trimEnd()
  }
  const floor = FLOOR.exec(text)
  if (floor) {
    out['addr:floor'] = floor[1]
    text = text.slice(0, floor.index).trimEnd()
  }

  const housename = text.trim()
  // 出した順序を揃えるため、建物名は最後に先頭へ差し込む
  return housename ? { 'addr:housename': housename, ...out } : out
}
