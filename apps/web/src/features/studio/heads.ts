import { SAMPLE_HEADS, type SampleHead, type SampleKey } from './samples'
import type { ChangedPart, FaceModelSummary } from './types'

/**
 * 작업실 경로·모델 목록 규칙. 화면 없이 테스트할 수 있게 순수 함수로 둔다.
 */

export const STUDIO_PATH = '/studio'
export const STUDIO_NEW_PATH = '/studio/new'

export type StudioTab = 'heads' | 'records'

/**
 * 작업실 주소. 다른 화면이 특정 머리·탭을 열 때 쓴다.
 * - `?faceModelId=<id>` — 그 내 모델을 골라 둔 채 연다(3D 완성 뒤 `[작업실에서 보기]`, -194)
 * - `?tab=records` — 최근 기록 탭으로 연다
 */
export function studioHref(options: { faceModelId?: string; tab?: StudioTab } = {}): string {
  const params = new URLSearchParams()
  if (options.faceModelId) params.set('faceModelId', options.faceModelId)
  if (options.tab === 'records') params.set('tab', 'records')
  const query = params.toString()
  return query ? `${STUDIO_PATH}?${query}` : STUDIO_PATH
}

/** 시안(최근 기록) 열기 = 편집 화면이 API-EDIT-03으로 이어서 편집한다(-156) */
export function simulationHref(simulationId: string): string {
  return `/simulations/${encodeURIComponent(simulationId)}`
}

/** 기본 모델로 시작하기 = 체험 실험실(-156). 샘플은 서버에 시안을 만들지 않는다 */
export function labHref(sample: SampleKey): string {
  return `/lab?sample=${sample}`
}

export type HeadOption =
  | {
      kind: 'own'
      id: string
      faceModelId: string
      title: string
      createdAt: string
      thumbnailUrl: string | null
      /** 빈 시안 제외(HIS-01). 3D를 지우면 함께 지워지는 시안 수 */
      simulationCount: number
    }
  | { kind: 'sample'; id: string; sample: SampleHead }

/** 내 모델 기본 이름. 서버(API-HIS-01 `title`)도 같은 값을 기본으로 준다 */
export const DEFAULT_HEAD_TITLE = '내 모델'

/** 서버가 준 내 모델 이름. 비어 있을 때만 기본 이름을 쓴다 */
export function ownHeadTitle(title: string | null | undefined): string {
  // 서버 기본 이름은 아직 '내 머리'(·'내 머리 2' …)다. 화면 말은 '모델'로 통일해 보인다(2026-10-31)
  return title?.trim().replace(/^내 머리(?=$| )/, DEFAULT_HEAD_TITLE) || DEFAULT_HEAD_TITLE
}

/** 내 모델 이름 1~20자(API-HIS-08 가안). 앞뒤 공백을 뺀 길이 */
export const HEAD_TITLE_MAX = 20

/** 앞뒤 공백을 뺀 이름이 규칙에 맞지 않으면 문구, 맞으면 null */
export function validateHeadTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return '이름을 적어 주세요.'
  if (trimmed.length > HEAD_TITLE_MAX) return `이름은 ${HEAD_TITLE_MAX}자까지예요.`
  return null
}

/** 머리 선택 목록. 내 모델(최신 먼저)가 맨 앞, 그다음 기본 모델 2종(남성·여성) (P3-42) */
export function buildHeadOptions(
  faceModels: readonly FaceModelSummary[],
  samples: readonly SampleHead[] = SAMPLE_HEADS,
): HeadOption[] {
  return [
    ...faceModels.map((model): HeadOption => ({
      kind: 'own',
      id: `own:${model.faceModelId}`,
      faceModelId: model.faceModelId,
      title: ownHeadTitle(model.title),
      createdAt: model.createdAt,
      thumbnailUrl: model.thumbnailUrl,
      simulationCount: model.simulationCount,
    })),
    ...samples.map((sample): HeadOption => ({
      kind: 'sample',
      id: `sample:${sample.key}`,
      sample,
    })),
  ]
}

/** 처음 고를 머리: 주소의 faceModelId가 목록에 있으면 그것, 아니면 맨 앞 */
export function initialHeadId(
  options: readonly HeadOption[],
  faceModelId: string | null | undefined,
): string | null {
  if (faceModelId) {
    const found = options.find((o) => o.kind === 'own' && o.faceModelId === faceModelId)
    if (found) return found.id
  }
  return options[0]?.id ?? null
}

/** 지운 내 모델 자리에 밀려 들어올 모델 id. 맨 끝이었으면 바로 앞 모델. 목록에 없던 모델이면 null(처음 고르기) */
export function nextAfterDelete(
  options: readonly HeadOption[],
  faceModelId: string,
): string | null {
  const index = options.findIndex((o) => o.kind === 'own' && o.faceModelId === faceModelId)
  if (index < 0) return null
  const rest = options.filter((_, i) => i !== index)
  return rest[Math.min(index, rest.length - 1)]?.id ?? null
}

export function headTitle(option: HeadOption): string {
  return option.kind === 'own' ? option.title : option.sample.title
}

const seoulParts = (iso: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Seoul',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )

/** `2026.10.22` (Asia/Seoul) */
export function formatFullDate(iso: string): string {
  const { year, month, day } = seoulParts(iso)
  return `${year}.${month}.${day}`
}

const PART_LABELS: Record<string, string> = { EYE: '눈', NOSE: '코', CONTOUR: '윤곽', HAIR: '헤어' }

/** 변경 부위 `코·눈`. 썸네일이 없어 기록을 이름·수정일·변경 부위로 구분한다(REQ-F-17) */
export function changedPartsLabel(parts: readonly ChangedPart[]): string {
  return parts.map((part) => PART_LABELS[part] ?? part).join('·')
}

/** 마지막 글자의 받침: 없음 · ㄹ · 그 밖 */
type Final = 'none' | 'rieul' | 'other'

/** 숫자를 한국어로 읽을 때 마지막 소리: 영·일·삼·육·칠·팔은 받침이 있고 이·사·오·구는 없다 */
const DIGIT_FINAL: Record<string, Final> = {
  '0': 'other',
  '1': 'rieul',
  '2': 'none',
  '3': 'other',
  '4': 'none',
  '5': 'none',
  '6': 'other',
  '7': 'rieul',
  '8': 'rieul',
  '9': 'none',
}

/** 한글·숫자로 끝나지 않으면 `null` */
function finalOf(word: string): Final | null {
  const last = word.trim().at(-1)
  if (!last) return null
  if (last in DIGIT_FINAL) return DIGIT_FINAL[last]
  const code = last.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return null
  const jong = code % 28
  if (jong === 0) return 'none'
  return jong === 8 ? 'rieul' : 'other'
}

type ParticlePair = '을/를' | '이/가' | '은/는' | '과/와' | '으로/로'

/**
 * 이름 뒤 조사: 받침이 있으면 앞쪽(`을`), 없으면 뒤쪽(`를`).
 * `으로/로`는 ㄹ 받침도 `로`다. 숫자는 한국어 읽기(`2` → 이)로 판단하고,
 * 한글·숫자가 아닌 글자로 끝나면 `을(를)`처럼 둘 다 적는다.
 */
export function particle(word: string, pair: ParticlePair): string {
  const [withFinal, withoutFinal] = pair.split('/') as [string, string]
  const final = finalOf(word)
  if (final === null) {
    return pair === '으로/로' ? '(으)로' : `${withFinal}(${withoutFinal})`
  }
  if (final === 'none') return withoutFinal
  if (final === 'rieul' && pair === '으로/로') return withoutFinal
  return withFinal
}

/** 목적격 조사 `을`/`를`. 판단할 수 없으면 `을(를)` */
export function objectParticle(word: string): string {
  return particle(word, '을/를')
}
