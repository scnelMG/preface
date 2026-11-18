import { isSampleKey, type SampleKey } from '@/features/studio/samples'
import { SAMPLE_CONTOUR_PART } from '../contourControls'
import { SAMPLE_NOSE_CATALOG } from '../noseControls'
import { SAMPLE_WEIGHT_SHAPE_ITEM } from '../weightShapeControls'

/**
 * 메인 체험(MainStudio)에서 바꾼 기본 모델·조절값을 체험 실험실(`/lab`)로 이어 준다(S15P31B204-746).
 *
 * - 탭 안에서만 산다(sessionStorage). 서버에 보내지 않는다(FN-REC-04 체험 값은 브라우저에만).
 * - 메인은 바뀔 때마다 지금 상태를 쓴다. 손대지 않은 상태(처음 모델, 값이 모두 0)면 지운다.
 * - 실험실은 들어올 때 한 번 읽고 **바로 지운다**(한 번 쓰는 표). 실험실에서 새로고침하거나 작업실을 거쳐 다시 와도
 *   예전 메인 값이 되살아나지 않는다. 체험 실험실 값이 새로고침하면 사라지는 지금 동작과 같다.
 * - 저장소가 막혀 있거나(사생활 보호 모드 등) 모양이 다르면 없는 것으로 본다. 모르는 항목 코드·범위 밖 값·숫자가 아닌 값은 버린다.
 * - 눈(쌍꺼풀·트임)은 자체 편집 이력에 묶여 있어 넘기지 않는다. 코·윤곽·체중 슬라이더 값만 넘긴다.
 */
export const HOME_HANDOFF_STORAGE_KEY = 'preface.home-lab-handoff.v1'

export interface HomeHandoff {
  sample: SampleKey
  weights: Record<string, number>
}

/** 메인·체험 실험실 둘 다 가진 슬라이더 항목과 범위 */
const RANGES: ReadonlyMap<string, { min: number; max: number }> = new Map(
  [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART]
    .flatMap((part) => part.items)
    .concat(SAMPLE_WEIGHT_SHAPE_ITEM)
    .map((item) => [item.code, { min: item.min, max: item.max }]),
)

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // 저장소를 막으면 접근만 해도 SecurityError를 던지는 브라우저가 있다
    return null
  }
}

/** 알려진 항목만, 범위 안의 0이 아닌 값만 남긴다 */
export function cleanHandoffWeights(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const weights: Record<string, number> = {}
  for (const [code, raw] of Object.entries(value)) {
    const range = RANGES.get(code)
    if (!range || typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) continue
    if (raw < range.min || raw > range.max) continue
    weights[code] = raw
  }
  return weights
}

export function parseHomeHandoff(raw: string | null | undefined): HomeHandoff | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { sample, weights } = parsed as { sample?: unknown; weights?: unknown }
  if (typeof sample !== 'string' || !isSampleKey(sample)) return null
  return { sample, weights: cleanHandoffWeights(weights) }
}

/** 메인에서 부른다. null이면 손대지 않은 상태라 지운다 */
export function writeHomeHandoff(handoff: HomeHandoff | null): void {
  try {
    const store = storage()
    if (!store) return
    if (handoff) store.setItem(HOME_HANDOFF_STORAGE_KEY, JSON.stringify(handoff))
    else store.removeItem(HOME_HANDOFF_STORAGE_KEY)
  } catch {
    // 못 쓰면 실험실이 처음 상태로 열린다(지금 동작)
  }
}

/** 실험실에서 부른다. 읽기만 한다(렌더 중에 불러도 된다). 지우기는 `clearHomeHandoff` */
export function readHomeHandoff(): HomeHandoff | null {
  try {
    return parseHomeHandoff(storage()?.getItem(HOME_HANDOFF_STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearHomeHandoff(): void {
  writeHomeHandoff(null)
}
