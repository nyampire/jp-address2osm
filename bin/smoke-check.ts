// 決めた住所を API に送り、分割の結果が記録（bin/smoke-addresses.json）と同じかを確かめる。
// 使い方: node bin/smoke-check.ts --base <URL> [--cases <file>] [--record]
// 終了コード: 0 同じ、1 違いがある、2 送れなかった
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { compareSmoke, toSmokeCase, type SmokeCase } from '../src/smokeCheck.ts'

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    cases: { type: 'string', default: new URL('./smoke-addresses.json', import.meta.url).pathname },
    record: { type: 'boolean', default: false },
  },
})
if (!values.base) {
  process.stderr.write('使い方: node bin/smoke-check.ts --base <URL> [--cases <file>] [--record]\n')
  process.exit(2)
}

// 記録の前は住所だけの配列でもよい
const expected = JSON.parse(readFileSync(values.cases, 'utf8')) as (SmokeCase | string)[]
const addresses = expected.map((c) => (typeof c === 'string' ? c : c.address))

const actual: SmokeCase[] = []
for (const address of addresses) {
  try {
    const res = await fetch(new URL('/api/v1/parse', values.base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    actual.push(toSmokeCase(address, await res.json()))
  } catch (e) {
    process.stderr.write(`${address}: 送れませんでした（${(e as Error).message}）\n`)
    process.exit(2)
  }
}

if (values.record) {
  writeFileSync(values.cases, JSON.stringify(actual, null, 2) + '\n')
  process.stdout.write(`${actual.length}件を記録しました\n`)
  process.exit(0)
}

const diffs = compareSmoke(expected.filter((c): c is SmokeCase => typeof c !== 'string'), actual)
for (const d of diffs) process.stdout.write(d + '\n')
process.stdout.write(diffs.length === 0 ? `${actual.length}件とも記録と同じです\n` : `${diffs.length}件が記録と違います\n`)
process.exit(diffs.length === 0 ? 0 : 1)
