// 決めた住所を API に送り、分割の結果が記録と同じかを確かめる。
// 住所データを入れ替える前後で、判定や addr:full が変わっていないかを見るために使う

export type SmokeCase = { address: string; result: string; full: string | null }

export function toSmokeCase(address: string, response: unknown): SmokeCase {
  const body = response as { result?: unknown; candidates?: { tags?: Record<string, unknown> }[] }
  const full = body.candidates?.[0]?.tags?.['addr:full']
  return { address, result: String(body.result ?? ''), full: typeof full === 'string' ? full : null }
}

export function compareSmoke(expected: SmokeCase[], actual: SmokeCase[]): string[] {
  const got = new Map(actual.map((c) => [c.address, c]))
  const diffs: string[] = []
  for (const e of expected) {
    const a = got.get(e.address)
    got.delete(e.address)
    if (!a) {
      diffs.push(`${e.address}: 結果がありません`)
    } else if (a.result !== e.result || a.full !== e.full) {
      diffs.push(`${e.address}: ${e.result} ${e.full ?? '（候補なし）'} → ${a.result} ${a.full ?? '（候補なし）'}`)
    }
  }
  for (const a of got.values()) diffs.push(`${a.address}: 記録にありません`)
  return diffs
}
