export type ResultKind = 'jukyo' | 'chiban' | 'ambiguous' | 'unresolved'
export type CandidateKind = 'jukyo' | 'chiban' | 'town'
export type SegmentRole = 'postcode' | 'prefecture' | 'county' | 'city' | 'ward'
  | 'quarter' | 'neighbourhood' | 'block_number' | 'housenumber'
  | 'number_undecided' | 'chiban' | 'extra_number' | 'unlisted_place' | 'remainder'
export type Segment = { value: string; role: SegmentRole; tagged: boolean }
export type Candidate = { kind: CandidateKind; tags: Record<string, string>; note?: string
  guessed?: true; optionalTags?: Record<string, string> }
export type ParseResponse = {
  apiVersion: '1'; result: ResultKind; message: string
  segments: Segment[]; candidates: Candidate[]
}
