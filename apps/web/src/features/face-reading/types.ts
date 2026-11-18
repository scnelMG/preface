/**
 * AI 관상(재미용, S15P31B204-438 BE 가안 API). 3D 생성 작업 1개당 1건이고, 결과는 글(JSON)만 온다.
 * 설계: docs/design/face-reading.md
 */
export type FaceReadingStatus = 'PENDING' | 'DONE' | 'FAILED'

export type FaceReadingPart =
  'FOREHEAD' | 'EYEBROWS' | 'EYES' | 'EARS' | 'NOSE' | 'CHEEKS' | 'MOUTH' | 'CHIN'

export interface FaceReadingResult {
  /** 이 관상을 한 줄로 부르는 별명 */
  title: string
  /** 부위별 풀이 3~4개, 각 한 문장(위에서 아래 순서). -452 전에 만든 결과는 4~6개일 수 있다 */
  parts: { part: FaceReadingPart; name: string; reading: string }[]
  overall: string
  /** "이렇게 바꾸면(change) 관상이 이렇게 달라질 수 있어요(effect)" 1~2개(-452 전 결과는 3개까지) — 얼굴 전체 부위, 3D와는 아직 연결하지 않는다 */
  advice: { part: FaceReadingPart; change: string; effect: string }[]
}

export interface FaceReading {
  readingId: string
  jobId: string
  status: FaceReadingStatus
  /** DONE일 때만 */
  result: FaceReadingResult | null
  createdAt: string
}
