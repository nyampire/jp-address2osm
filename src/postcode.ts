// 〒付きは位置を問わず読む。〒無しは先頭の NNN-NNNN だけにする。
// 番地（1-2-6 など）や7桁の連続数字を郵便番号と取り違えないため
const WITH_MARK = /〒\s*(\d{3})-?(\d{4})(?!\d)/
const BARE_LEADING = /^(\d{3})-(\d{4})(?!\d)/

export function extractPostcode(input: string): { postcode?: string; rest: string } {
  const text = input.normalize('NFKC').trim()
  // ハイフン類の寄せは照合用の複製だけに行う。1文字→1文字なので添字が揃い、
  // rest 側の「ハーバー」のような長音記号を壊さずに済む
  const forMatch = text.replace(/[ー－‐―−]/g, '-')
  const m = WITH_MARK.exec(forMatch) ?? BARE_LEADING.exec(forMatch)
  if (!m) return { rest: text }
  const before = text.slice(0, m.index).trimEnd()
  const after = text.slice(m.index + m[0].length).trimStart()
  const rest = before && after ? `${before} ${after}` : before + after
  return { postcode: `${m[1]}-${m[2]}`, rest }
}
