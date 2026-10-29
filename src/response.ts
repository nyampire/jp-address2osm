import { parseNumberElements } from '../vendor/nja-osm-tags/src/index.ts'
import type { ConversionResult, NumberJudgement, OsmTags } from '../vendor/nja-osm-tags/src/index.ts'
import { splitBuilding } from './building.ts'
import type { Candidate, CandidateKind, ParseResponse, ResultKind, Segment, SegmentRole } from './types.ts'

// 応答のタグのキーと並び。addr:country, note, fixme は含めない。addr:full は各候補の末尾に別に足す
const TOWN_KEYS = ['addr:province', 'addr:county', 'addr:city', 'addr:suburb', 'addr:quarter', 'addr:neighbourhood'] as const
const NUMBER_KEYS = ['addr:block_number', 'addr:housenumber'] as const

// 地番の前に挟まった地名と、地番の冠称（甲乙、イロハ、十二支）。冠称は地番の一部なので地名にはしない
const PREFIXED = /^(.*?)([甲乙丙丁戊己庚辛壬癸イロハニホヘトチリヌルヲ子丑寅卯辰巳午未申酉戌亥]?)(\d+(?:-\d+)*)(?![\d番丁条号街区階FＦ・])/u
// 地名は「字」「小字」を書いたものはカナも認め、書かないものは漢字2〜6文字に限る。
// 建物名や、町字の誤照合で残った1文字（「町」など）を地名と読まないため。
// 書かないものからは、市や郡を書き重ねた住所と、「番」「第」を含むもの（番地82、永田第5ビル）を除く。
// 数字の後ろが階や「・」のもの（明治館1階、札幌2・2ビル）は建物名として PREFIXED で除く
const PLACE_WITH_AZA = /^小?字[\p{sc=Han}\p{sc=Katakana}々ヶケノのー]{1,10}$/u
const PLACE_BARE = /^(?!.*[都道府県市郡番第])[\p{sc=Han}々ヶケノの]{2,6}$/u

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

type Plan = { result: ResultKind; kinds: CandidateKind[]; message: string; numberRole: SegmentRole; numberTagged: boolean; guessed?: true
  // 番地の区切りの根拠。台帳と照合した番地には付けない
  numberBasis?: string }

export function buildResponse(args: BuildArgs): ParseResponse {
  const { postcode, conversion, other, townOther, chibanNumber, judgement } = args
  const tags = conversion.tags
  // 住居表示を実施していない町字の住所だけ、番地の前に挟まった台帳に無い字名や通称と、地番の冠称を切り出す。
  // 地番の台帳と照合した住所（noNumberReason が chiban）は、NJA が番地を other から取り除いているので、
  // other に残った建物名を地名と読んでしまう
  const prefixed = conversion.noNumberReason === 'rsdt-not-implemented'
  const parsed = splitNumbers(other, prefixed)
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
    n = parsed.kanmuri + elements.slice(0, 2).join('-')
    extras = elements.slice(2)
  }

  const town = (tags['addr:quarter'] ?? '') + (tags['addr:neighbourhood'] ?? '')
  const plan = decide(conversion, judgement, town, n)

  // jukyo だけが番地のタグを持つ。chiban と town は町字で止める（地番の番地は出さない）
  // addr:full と建物名などの候補は、地番の台帳の値ではなく貼った文字列から作る
  // townOther が無い照合済みの住居表示は、other から番地が取り除かれているので、台帳（住居表示）の街区と住居番号で補う
  const fallbackNumber = townOther === undefined && conversion.numberSource === 'verified' ? n : ''
  const full = unresolved ? undefined : buildFull(tags, townOther ?? other, fallbackNumber, prefixed)
  const building = unresolved ? {} : splitBuilding(splitNumbers(townOther ?? other, prefixed).rest)
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
  if (parsed.place) {
    segments.push({ value: parsed.place, role: 'unlisted_place', tagged: false,
      basis: `町字「${town}」と番地の間にあり、アドレス・ベース・レジストリの町字にありません。` })
  }
  segments.push(...numberSegments(conversion, plan, n, elements))
  const extra = extras.join('-')
  if (extra) segments.push({ value: extra, role: 'extra_number', tagged: false, basis: '番地の3つ目以降の要素で、当てはまるタグがありません。' })
  if (rest) {
    const basis = unresolved ? '町字を特定できなかったため、残りを分けていません。' : buildingBasis(building)
    segments.push({ value: rest, role: 'remainder', tagged: false, ...(basis ? { basis } : {}) })
  }

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
          numberBasis: '住居表示の台帳に無く、地番の台帳にあります。',
          message: `地番の住所と判定しました。${town}の${n}は、住居表示の台帳に無く、地番の台帳にあります。番地はタグにしません。`,
        }
      case '判定不能':
        return {
          result: 'ambiguous', kinds: ['jukyo', 'chiban'], numberRole: 'number_undecided', numberTagged: true, guessed: true,
          numberBasis: `${town}は住居表示の実施済みですが、住居表示の台帳がなく、地番の台帳にもこの番地がありません。${GUESSED}`,
          message: `住居表示の住所と推測しました。ABRは${town}を住居表示の実施済みとしていますが、住居表示の台帳がなく、地番の台帳にも「${n}」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。`,
        }
      case '不一致':
        return {
          result: 'ambiguous', kinds: ['jukyo', 'chiban'], numberRole: 'number_undecided', numberTagged: true, guessed: true,
          numberBasis: `${town}は住居表示の実施済みですが、住居表示の台帳にも地番の台帳にもこの番地がありません。${GUESSED}`,
          message: `住居表示の住所と推測しました。ABRは${town}を住居表示の実施済みとしていますが、住居表示の台帳にも地番の台帳にも「${n}」がありません。台帳の欠けの可能性が高いため、住居表示として番地まで入れています。`,
        }
    }
  }
  switch (conv.noNumberReason) {
    case 'chiban':
      return {
        result: 'chiban', kinds: ['chiban'], numberRole: 'chiban', numberTagged: false,
        numberBasis: `地番の台帳に、${town}の${n}があります。`,
        message: `地番の住所です。地番の台帳に、${town}の${n}があります。番地はタグにしません。`,
      }
    case 'rsdt-not-implemented':
      return {
        result: 'chiban', kinds: ['chiban'], numberRole: 'chiban', numberTagged: false,
        numberBasis: `${town}は住居表示を実施していない町字なので、番地は地番です。`,
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
        numberBasis: `${town}は位置参照情報で補った町字で、住居表示か地番かを決める台帳がありません。`,
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
  const s: Segment = { value: n, role: plan.numberRole, tagged: plan.numberTagged }
  if (plan.numberBasis) s.basis = plan.numberBasis
  return [s]
}

const GUESSED = '台帳の欠けとみて、住居表示と推測しました。'
const BUILDING_LABELS: [string, string][] = [['addr:housename', '建物名'], ['addr:floor', '階'], ['addr:unit', '部屋番号']]

// 建物名などの候補の根拠。候補が無ければ空
function buildingBasis(building: Record<string, string>): string {
  const parts = BUILDING_LABELS.filter(([k]) => building[k]).map(([k, label]) => `${label}「${building[k]}」`)
  return parts.length > 0 ? `${parts.join('、')}は、番地の後ろの文字列から推測した候補です。` : ''
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
function buildFull(tags: OsmTags, other: string, fallbackNumber: string, prefixed: boolean): string {
  const { place: unlisted, kanmuri, elements, rest } = splitNumbers(other, prefixed)
  const place = TOWN_KEYS.map((k) => tags[k] ?? '').join('') + unlisted
  const number = [fallbackNumber, ...elements].filter(Boolean).join('-')
  return place + kanmuri + number + (rest ? ` ${rest}` : '')
}

type NumberSplit = { place: string; kanmuri: string; elements: string[]; rest: string }

// 番地の要素と残りに分ける。prefixed なら、町字の後ろに挟まった台帳に無い字名や通称と、
// 地番の冠称を、番地の前から切り出す（字大多志243-19、南国広1-1、甲1100-4 など）
function splitNumbers(other: string, prefixed: boolean): NumberSplit {
  const parsed = parseNumberElements(other)
  const plain = { place: '', kanmuri: '', ...parsed }
  if (!prefixed || parsed.elements.length > 0) return plain
  const m = PREFIXED.exec(parsed.rest)
  if (!m) return plain
  let place = m[1]!
  let kanmuri = m[2]!
  // 字名の後ろでは甲乙丙丁だけを冠称とする。字市上リ のようなカナの字名の末尾を冠称と読まないため
  if (place && kanmuri && !'甲乙丙丁'.includes(kanmuri)) {
    place += kanmuri
    kanmuri = ''
  }
  if (!place && !kanmuri) return plain
  const isPlace = PLACE_WITH_AZA.test(place) || PLACE_BARE.test(place)
  if (place && (!isPlace || place.startsWith('大字') || place.endsWith('丁目'))) return plain
  const after = parseNumberElements(parsed.rest.slice(place.length + kanmuri.length))
  return { place, kanmuri, elements: after.elements, rest: after.rest }
}

function joinNonEmpty(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join('-')
}
