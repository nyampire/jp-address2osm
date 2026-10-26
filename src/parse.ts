import { toOsmTags } from '../vendor/nja-osm-tags/src/index.ts'
import type { NormalizeResult, NumberJudgement, OsmTags } from '../vendor/nja-osm-tags/src/index.ts'
import type { FailureEntry } from './failureLog.ts'
import { extractPostcode } from './postcode.ts'
import { buildResponse } from './response.ts'
import type { ParseResponse } from './types.ts'

export type ParseDeps = {
  normalize: (s: string, options?: { level?: number }) => Promise<NormalizeResult>
  judge: (tags: OsmTags) => NumberJudgement
  logFailure: (entry: FailureEntry) => void
}

// 町字を特定できなかった応答。postcode だけを区切りとして返す
function unresolvedResponse(postcode: string | undefined): ParseResponse {
  return buildResponse({
    postcode,
    conversion: { tags: {}, numberSource: 'none', noNumberReason: 'machiaza-unresolved', extra: {} },
    other: '',
    judgement: '',
  })
}

// 町字までの段階の other。失敗したり別の町字を選んだりしたら undefined にし、通常の other に任せる。
// 失敗は応答に影響させず、記録もしない
async function townLevelOther(rest: string, full: NormalizeResult, deps: ParseDeps): Promise<string | undefined> {
  try {
    const town = await deps.normalize(rest, { level: 3 })
    const id = full.metadata?.machiAza?.machiaza_id
    return id && id === town.metadata?.machiAza?.machiaza_id ? (town.other ?? '') : undefined
  } catch {
    return undefined
  }
}

export async function parseAddress(address: string, deps: ParseDeps): Promise<ParseResponse> {
  const { postcode, rest } = extractPostcode(address)
  if (!rest) {
    deps.logFailure({ address, reason: 'empty' })
    return unresolvedResponse(postcode)
  }

  let result: NormalizeResult
  try {
    result = await deps.normalize(rest)
  } catch {
    // 例外の中身に住所が含まれうるので、ここでは出力せず理由だけ記録する
    deps.logFailure({ address, reason: 'normalize-error' })
    return unresolvedResponse(postcode)
  }

  const conversion = toOsmTags(result, { country: false })
  // judge は台帳を引くので、番地を推定したときだけ呼ぶ
  const judgement = conversion.numberSource === 'inferred' ? deps.judge(conversion.tags) : ''
  const chiban = result.metadata?.chiban
  const chibanNumber = chiban
    ? [chiban.prc_num1, chiban.prc_num2, chiban.prc_num3].filter(Boolean).join('-')
    : undefined

  // 町字が決まった住所だけ、町字までの段階でも呼ぶ。NJA は照合できた番地を other から取り除くので、
  // addr:full の番地は貼った文字列に近いこの結果から取る
  const unresolved = conversion.numberSource === 'none' && (!conversion.noNumberReason || conversion.noNumberReason === 'machiaza-unresolved')
  const townOther = unresolved
    ? undefined
    : await townLevelOther(rest, result, deps)

  const response = buildResponse({ postcode, conversion, other: result.other ?? '', townOther, chibanNumber, judgement })
  if (response.result === 'unresolved') deps.logFailure({ address, reason: 'machiaza-unresolved' })
  return response
}
