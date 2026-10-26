import { parseNumberElements } from '../vendor/nja-osm-tags/src/index.ts'
import type { ConversionResult, NumberJudgement, OsmTags } from '../vendor/nja-osm-tags/src/index.ts'
import { splitBuilding } from './building.ts'
import type { Candidate, CandidateKind, ParseResponse, ResultKind, Segment, SegmentRole } from './types.ts'

// 応答のタグのキーと並び。addr:country, note, fixme は含めない。addr:full は各候補の末尾に別に足す
const TOWN_KEYS = ['addr:province', 'addr:county', 'addr:city', 'addr:suburb', 'addr:quarter', 'addr:neighbourhood'] as const
const NUMBER_KEYS = ['addr:block_number', 'addr:housenumber'] as const

// 区切りの並びと役割。ward は addr:suburb（政令市の区）に当たる
const PLACE_ROLES: [keyof OsmTags, SegmentRole][] = [
  ['addr:province', 'prefecture'], ['addr:county', 'county'], ['addr:city', 'city'],
  ['addr:suburb', 'ward'], ['addr:quarter', 'quarter'], ['addr:neighbourhood', 'neighbourhood'],
]

export type BuildArgs = {
  postcode?: string
  conversion: ConversionResult
  other: string
  // NJA を町字までの段階で呼んだ結果の other。addr:full の番地と建物名の切り分けに使う。無ければ other
  townOther?: string
  chibanNumber?: string
  judgement: NumberJudgement
}

type Plan = { result: ResultKind; kinds: CandidateKind[]; message: string; numberRole: SegmentRole; numberTagged: boolean; guessed?: true }

export function buildResponse(args: BuildArgs): ParseResponse {
  const { postcode, conversion, other, townOther, chibanNumber, judgement } = args
  const tags = conversion.tags
  const parsed = parseNumberElements(other)
  // 町字が決まらなかった住所は、残りを番地と読まずそのまま remainder に回す
  const unresolved = conversion.numberSource === 'none' && (!conversion.noNumberReason || conversion.noNumberReason === 'machiaza-unresolved')
  const elements = unresolved ? [] : parsed.elements
  const rest = unresolved ? other.trim() : parsed.rest

  // 番地の文字列 n と、番地の後ろの extra_number の元になる要素。
  // NJA は照合できた番地を other から取り除くので、出どころで分ける
  let n = ''
  let extras: string[] = elements
  if (conversion.numberSource === 'verified') {
    n = joinNonEmpty([tags['addr:block_number'], tags['addr:housenumber']])
  } else if (chibanNumber) {
    n = chibanNumber
  } else {
    n = elements.slice(0, 2).join('-')
    extras = elements.slice(2)
  }

  const town = (tags['addr:quarter'] ?? '') + (tags['addr:neighbourhood'] ?? '')
  const plan = decide(conversion, judgement, town, n)

  // jukyo だけが番地のタグを持つ。chiban と town は町字で止める（地番の番地は出さない）
  // addr:full と建物名などの候補は、地番の台帳の値ではなく貼った文字列から作る
  // townOther が無い照合済みの住居表示は、other から番地が取り除かれているので、台帳（住居表示）の街区と住居番号で補う
  const fallbackNumber = townOther === undefined && conversion.numberSource === 'verified' ? n : ''
  const full = unresolved ? undefined : buildFull(tags, townOther ?? other, fallbackNumber)
  const building = unresolved ? {} : splitBuilding(parseNumberElements(townOther ?? other).rest)
  const candidates: Candidate[] = plan.kinds.map((kind) => {
    const c: Candidate = { kind, tags: pickTags(postcode, tags, kind === 'jukyo') }
    if (full) c.tags['addr:full'] = full
    if (Object.keys(building).length > 0) c.optionalTags = { ...building }
    if (plan.guessed && kind === 'jukyo') c.guessed = true
    if (kind === 'chiban' && n) c.note = `地番の「${n}」はタグにしません。`
    return c
  })

  const tagged = candidates.length > 0
  const segments: Segment[] = []
  if (postcode) segments.push({ value: postcode, role: 'postcode', tagged })
  for (const [key, role] of PLACE_ROLES) {
    const value = tags[key]
    if (value) segments.push({ value, role, tagged })
  }
  segments.push(...numberSegments(conversion, plan, n, elements))
  const extra = extras.join('-')
  if (extra) segments.push({ value: extra, role: 'extra_number', tagged: false })
  if (rest) segments.push({ value: rest, role: 'remainder', tagged: false })

  return { apiVersion: '1', result: plan.result, message: plan.message, segments, candidates }
}

function decide(conv: ConversionResult, judgement: NumberJudgement, town: string, n: string): Plan {
  const jukyoMsg = `住居表示の住所です。住居表示の台帳に、${town}の${n}があります。`
  if (conv.numberSource === 'verified') {
    return { result: 'jukyo', kinds: ['jukyo'], message: jukyoMsg, numberRole: 'block_number', numberTagged: true }
  }
  if (conv.numberSource === 'inferred') {
    switch (judgement) {
      case '':
        return { result: 'jukyo', kinds: ['jukyo'], message: jukyoMsg, numberRole: 'block_number', numberTagged: true }
      case '地番':
        return {
          result: 'chiban', kinds: ['chiban'], numberRole: 'chiban', numberTagged: false,
          message: `地番の住所と判定しました。${town}の${n}は、住居表示の台帳に無く、地番の台帳にあります。番地はタグにしません。`,
        }
      case '判定不能':
        return {
          result: 'ambiguous', kinds: ['jukyo', 'chiban'], numberRole: 'number_undecided', numberTagged: true, guessed: true,
          message: `住居表示の住所と推測しました。ABRは${town}を住居表示の実施済みとしていますが、住居表示の台帳がなく、地番の台帳にも「${n}」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。`,
        }
      case '不一致':
        return {
          result: 'ambiguous', kinds: ['jukyo', 'chiban'], numberRole: 'number_undecided', numberTagged: true, guessed: true,
          message: `住居表示の住所と推測しました。ABRは${town}を住居表示の実施済みとしていますが、住居表示の台帳にも地番の台帳にも「${n}」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。`,
        }
    }
  }
  switch (conv.noNumberReason) {
    case 'chiban':
      return {
        result: 'chiban', kinds: ['chiban'], numberRole: 'chiban', numberTagged: false,
        message: `地番の住所です。地番の台帳に、${town}の${n}があります。番地はタグにしません。`,
      }
    case 'rsdt-not-implemented':
      return {
        result: 'chiban', kinds: ['chiban'], numberRole: 'chiban', numberTagged: false,
        message: `地番の住所です。${town}は住居表示を実施していない町字です。番地はタグにしません。`,
      }
    case 'rsdt-detail-missing':
      return {
        result: 'jukyo', kinds: ['jukyo'], numberRole: 'block_number', numberTagged: false,
        message: '住居表示の住所ですが、番地を読み取れませんでした。番地はタグにしません。',
      }
    case 'machiaza-from-mlit':
      return {
        result: 'ambiguous', kinds: ['town'], numberRole: 'number_undecided', numberTagged: false,
        message: `住居表示か地番かを決められません。${town}は台帳に番地の明細が無い町字です。番地はタグにしません。`,
      }
    default:
      // machiaza-unresolved と、理由の無い none
      return {
        result: 'unresolved', kinds: [], numberRole: 'remainder', numberTagged: false,
        message: '町字を特定できず、住所を分けられませんでした。この住所は改善のために記録します。',
      }
  }
}

function numberSegments(conv: ConversionResult, plan: Plan, n: string, elements: string[]): Segment[] {
  if (!n) return []
  const tags = conv.tags
  if (plan.numberRole === 'block_number') {
    // 住居表示は街区符号と住居番号に分けて出す
    const block = conv.numberSource === 'verified' ? tags['addr:block_number'] : elements[0]
    const house = conv.numberSource === 'verified' ? tags['addr:housenumber'] : elements[1]
    const out: Segment[] = []
    if (block) out.push({ value: block, role: 'block_number', tagged: true })
    if (house) out.push({ value: house, role: 'housenumber', tagged: true })
    return out
  }
  return [{ value: n, role: plan.numberRole, tagged: plan.numberTagged }]
}

function pickTags(postcode: string | undefined, tags: OsmTags, withNumber: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  if (postcode) out['addr:postcode'] = postcode
  const keys: readonly (keyof OsmTags)[] = withNumber ? [...TOWN_KEYS, ...NUMBER_KEYS] : TOWN_KEYS
  for (const k of keys) {
    const v = tags[k]
    if (v) out[k] = v
  }
  return out
}

// 町字までの値、貼った文字列の番地、建物名などの残りをつなぐ。郵便番号は入れない
// fallbackNumber は other に番地が無いときの番地（住居表示の台帳の値だけ）。地番の台帳の値は渡さない
function buildFull(tags: OsmTags, other: string, fallbackNumber: string): string {
  const { elements, rest } = parseNumberElements(other)
  const place = TOWN_KEYS.map((k) => tags[k] ?? '').join('')
  const number = [fallbackNumber, ...elements].filter(Boolean).join('-')
  return place + number + (rest ? ` ${rest}` : '')
}

function joinNonEmpty(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('-')
}
