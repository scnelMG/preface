import { changeEyes, type EyeLimits, type EyeState } from '../eyes/state'
import { noseControlChanges, type PartControl } from '../noseControls'
import type { FaceProfile, MeasureProfileTrial } from './faceProfile'

const profileSource = {
  label: 'Ricketts · 입술과 측면 기준선 (1968)',
  url: 'https://pubmed.ncbi.nlm.nih.gov/5238879/',
  note: '기준선이 움직일 때 달라지는 상대 위치예요. 입술 자체의 이동량은 알 수 없어요.',
}
const frontSource = {
  label: 'FaceBase · 3D 얼굴 표면 기준점',
  url: 'https://www.facebase.org/resources/human/facial_norms/notes/',
  note: '현재 시안의 3D 표면에서 확인한 참고 비율이에요.',
}

const comparisons = [
  {
    id: 'chinProjection',
    part: '윤곽',
    label: '턱끝 앞뒤',
    summary: '입매와 턱끝이 이어지는 선',
    metric: 'upper-lip-profile-line',
    view: 'side',
    source: profileSource,
  },
  {
    id: 'jawAngle',
    part: '윤곽',
    label: '사각턱',
    summary: '아래턱 윤곽의 폭',
    metric: 'jaw-width-face-width',
    view: 'front',
    source: frontSource,
  },
  {
    id: 'chinLength',
    part: '윤곽',
    label: '턱끝 길이',
    summary: '얼굴의 가로·세로 비율',
    metric: 'eye-to-chin-face-width',
    view: 'front',
    source: frontSource,
  },
  {
    id: 'projection',
    part: '코',
    label: '코끝 앞뒤',
    summary: '코끝과 입매가 이어지는 선',
    metric: 'upper-lip-profile-line',
    view: 'side',
    source: profileSource,
  },
  {
    id: 'eyeInner',
    part: '눈',
    label: '앞트임',
    summary: '눈 안쪽 간격',
    metric: 'intercanthal-outer-eye-width',
    view: 'front',
    source: frontSource,
  },
] as const

const keepPart =
  /턱\s*끝(?:\s*(?:앞뒤|길이|폭))?|사각\s*턱|아래\s*턱|턱\s*선|윤곽|코\s*끝(?:\s*(?:앞뒤|돌출|위아래|높이))?|코|눈(?:\s*안쪽)?|앞\s*트임/g
const keepRequest = new RegExp(
  String.raw`((?:${keepPart.source})(?:\s*(?:과|와|이랑|랑|그리고|,|·)\s*(?:${keepPart.source}))*)(?:은|는|을|를|만)?\s*(?:지금\s*(?:상태로|모습으로)?\s*)?(?:그대로|유지|빼고|제외하고|(?:건드리지|바꾸지|조절하지|수정하지)\s*(?:말|않))`,
  'g',
)

export function nextAdjustmentQuestion(text: string, hasSelectedControl = false) {
  if (/수술|시술|처방|진단|견적/.test(text)) return false

  // 완료한 편집을 언급해도, 뒤에 다음 선택을 묻는다면 전체 추천이다.
  if (
    /(?:(?:그\s*(?:다음|뒤)|다음(?:으로)?)(?:에(?:는|도)?|엔)?|이제|더)\s*(?:뭘|뭐(?:를|가)?|무엇(?:을|이)?|어디(?:를|가)?)(?:\s*부터)?\s*(?:하면\s*좋|할\s*까|하면\s*될|해\s*볼|(?:바꿀지|조절할지|수정할지)\s*모르|(?:바꿔|조절해|손봐)\s*볼|(?:바꾸면|조절하면|손보면)\s*좋)/.test(
      text,
    )
  )
    return true
  if (
    /(?:뭘|뭐(?:를)?|무엇(?:을)?|어디(?:를)?)\s*(?:바꾸면|조절하면|손보면)\s*(?:전체\s*)?(?:인상|분위기|느낌|얼굴(?:이|은))/.test(
      text,
    )
  )
    return true

  // 열린 후보를 요청하는 표현은 직전에 고른 슬라이더의 방향 질문과 구분한다.
  if (
    /(?:손봐\s*볼|손볼|바꿔\s*볼|조절해\s*볼|조절할|수정할)\s*(?:만한\s*)?(?:곳|부위|부분)[^.!?]{0,24}(?:추천|제안|알려|어디|어딜|뭐|있(?:어|나|을))/.test(
      text,
    )
  ) {
    return true
  }

  return (
    (!hasSelectedControl ||
      /전체|전반|다른\s*부위|어디|어느\s*(?:부분|부위)|뭐부터|무엇부터|다음\s*조절/.test(text)) &&
    /(?:어디|어느\s*(?:부분|부위)|뭘|뭐부터|무엇|다음|방향|전체|전반|다른\s*부위).{0,32}(?:바꿔\s*(?:볼|보면)|바꾸면|조절\s*(?:할|해\s*볼|하면)|수정\s*(?:할|하면)|손대|손보면|손볼|손봐\s*볼|추천|제안|해\s*볼|하면\s*좋)/.test(
      text,
    )
  )
}

export const RECOMMENDATION_STEP = 30

export function adjustmentChoices(
  control: PartControl,
  weights: Readonly<Record<string, number>>,
  step = 10,
) {
  if (control.mixed) return []
  return ([-1, 1] as const).flatMap((direction) => {
    const target = Math.max(
      control.min * 100,
      Math.min(control.max * 100, Math.round(control.value * 100) + direction * step),
    )
    const changed = noseControlChanges(control, target / 100).some(
      ({ code, value }) =>
        (value - (weights[code] ?? 0)) *
          direction *
          (control.effects.find((effect) => effect.code === code)?.gain ?? 0) >
        0,
    )
    return changed ? [{ direction, target }] : []
  })
}

export function faceAdjustmentEvidence(profile: FaceProfile | null | undefined, id: string) {
  const candidate = comparisons.find((item) => item.id === id)
  if (!candidate || !profile) return
  const evidence = Object.values(profile)
    .flat()
    .find((item) => item.id === candidate.metric)
  if (!evidence) return
  const side = candidate.metric === 'upper-lip-profile-line'
  if (!(side ? /^[+-]?\d+(?:\.\d+)?%$/ : /^\d+(?:\.\d+)?배$/).test(evidence.value)) return
  const value = Number(evidence.value.slice(0, -1))
  const ratio = side ? value / 100 : value
  if (!(side ? Math.abs(ratio) <= 1 : ratio > 0 && ratio <= 2)) return
  const firstDirection = !side || ratio === 0 ? undefined : ratio < 0 ? -1 : 1
  return { ...candidate, evidence, ratio, firstDirection }
}

type Recommendation = NonNullable<ReturnType<typeof faceAdjustmentEvidence>>

export function recommendationMeasurements(recommendations: readonly Recommendation[]) {
  return recommendations.length
    ? {
        recommendationMeasurements: Object.fromEntries(
          recommendations.map(({ metric, ratio }) => [metric, ratio]),
        ),
      }
    : {}
}

export function measuredRecommendationInputs(
  recommendations: readonly Recommendation[],
  controls: readonly PartControl[],
  weights: Readonly<Record<string, number>> | undefined,
  measureTrial: MeasureProfileTrial | null,
  stateVersion: number | undefined,
  eyes?: { state: EyeState; limits: EyeLimits | undefined; limit: number },
) {
  const measurements: Record<string, number> = {}
  let eyeTrials: Promise<void> | undefined
  for (const { id, metric, evidence, ratio } of recommendations) {
    const before = evidence.rawRatio ?? ratio
    measurements[metric] = before
    if (id === 'eyeInner' && eyes && measureTrial?.eye) {
      const { state, limits, limit } = eyes
      const anchor = state.L.values.inner
      const measureEye = measureTrial.eye
      eyeTrials = Promise.all(
        ([-1, 1] as const).map(async (direction) => {
          const next = changeEyes(
            state,
            'both',
            {
              type: 'control',
              control: 'inner',
              value: anchor + (direction * limit * RECOMMENDATION_STEP) / 100,
              relativeTo: 'L',
            },
            { limits },
          )
          if (next.L.values.inner === anchor && next.R.values.inner === state.R.values.inner) return
          const trial = faceAdjustmentEvidence(await measureEye(next), id)
          const after = trial?.evidence.rawRatio ?? trial?.ratio
          if (after !== undefined && Math.abs(after - before) >= 0.00001) {
            return { direction, after }
          }
        }),
      ).then((trials) => {
        for (const trial of trials) {
          if (trial) measurements[id + (trial.direction < 0 ? ':down' : ':up')] = trial.after
        }
      })
      continue
    }
    const control = controls.find((item) => item.id === id)
    if (!control || !weights || !measureTrial) continue
    for (const { direction, target } of adjustmentChoices(control, weights, RECOMMENDATION_STEP)) {
      const trial = faceAdjustmentEvidence(
        measureTrial(noseControlChanges(control, target / 100)),
        id,
      )
      if (!trial) continue
      const after = trial.evidence.rawRatio ?? trial.ratio
      if (Math.abs(after - before) >= 0.00001)
        measurements[id + (direction < 0 ? ':down' : ':up')] = after
    }
  }
  const payload = () => ({
    recommendationMeasurements: {
      ...measurements,
      'trial-version': 1,
      ...(stateVersion === undefined ? {} : { 'trial-state': stateVersion }),
    },
  })
  return eyeTrials ? eyeTrials.then(payload) : payload()
}

export function measuredRecommendationDetails(section: string[], id: string) {
  const match = section[1]?.split(',').indexOf(id) ?? -1
  const directionData = section[section.indexOf('measured') + 1]?.split(',')[match]
  if (!section.includes('measured') || !directionData) return null
  const [direction, before, after] = directionData.split('/').map(Number)
  if ((direction !== -1 && direction !== 1) || !Number.isFinite(before) || !Number.isFinite(after))
    return null
  return { direction, before, after, index: match }
}

export function measuredRecommendationCopy(
  recommendation: Recommendation,
  measured: NonNullable<ReturnType<typeof measuredRecommendationDetails>>,
  modelEffect: string | undefined,
) {
  const { direction, before, after } = measured
  const forward = direction > 0
  const more = after > before
  let action: string
  let suggestion: string
  let effect: string
  switch (recommendation.id) {
    case 'projection':
    case 'chinProjection': {
      const part = recommendation.id === 'projection' ? '코끝' : '턱끝'
      action = `${part}을 살짝 ${forward ? '앞으로' : '뒤로'}`
      suggestion = `${action} 옮겨 보세요.`
      effect = `옆에서 봤을 때 ${part}이 ${forward ? '조금 더' : '덜'} 도드라져 보여요.`
      break
    }
    case 'jawAngle':
      action = `사각턱 폭을 살짝 ${forward ? '넓혀' : '좁혀'}`
      suggestion = `${action} 보세요.`
      effect = `정면에서 아래턱이 조금 ${more ? '넓어' : '좁아'} 보여요.`
      break
    case 'chinLength':
      action = `턱끝을 살짝 ${forward ? '길게' : '짧게'}`
      suggestion = `${action} 조절해 보세요.`
      effect = `정면에서 얼굴 아래쪽이 조금 ${more ? '길어' : '짧아'} 보여요.`
      break
    case 'eyeInner':
      action = `앞트임을 살짝 ${forward ? '늘려' : '줄여'}`
      suggestion = `${action} 보세요.`
      effect = `정면에서 눈머리 사이가 조금 ${more ? '넓어' : '좁아'} 보여요.`
      break
  }
  const text = modelEffect?.trim()
  const usableEffect =
    text &&
    text.length <= 80 &&
    /^[^.!?A-Za-z0-9<>&\r\n]+[.!?]?$/.test(text) &&
    /^(?:정면|옆(?:에서|모습))/.test(text) &&
    !/보세요|추천|근거 보기|기준선/.test(text)
  return { action, suggestion, effect: usableEffect ? text : effect }
}

export function formatTrialChange(before: number, after: number, side: boolean) {
  const format = (value: number, digits: number) => `${Number((value * 100).toFixed(digits))}%`
  const digits = side ? 1 : 0
  const precision = format(before, digits) === format(after, digits) ? 3 : digits
  return format(before, precision) + ' → ' + format(after, precision)
}

export function recommendationGuidance(
  recommendation: Recommendation,
  directions: readonly number[],
) {
  const { id, ratio } = recommendation
  const percent = Math.round(ratio * 100)
  const decrease = directions.includes(-1)
  const increase = directions.includes(1)
  if (id === 'eyeInner') {
    return {
      analysis: `눈머리 간격은 양쪽 눈꼬리 사이 너비의 약 ${percent}%예요.`,
      goal: '정면에서 눈머리 사이 여백이 어떻게 달라지는지 살펴봐요.',
      direction: increase
        ? '눈 안쪽을 더 열어 보려면 앞트임을 조금 늘려 보세요.'
        : decrease
          ? '눈머리 사이 여백을 더 두려면 앞트임을 조금 줄여 보세요.'
          : undefined,
    }
  }
  if (id === 'jawAngle') {
    return {
      analysis: `아래턱 폭은 얼굴 폭의 약 ${percent}%예요.`,
      goal: '정면에서 턱선이 얼마나 모이거나 넓어 보이는지 비교해요.',
      direction:
        decrease && increase
          ? '턱선을 더 모아 보려면 좁게, 폭을 살리려면 넓게 움직여 보세요.'
          : decrease
            ? '턱선을 더 모아 보려면 좁게 움직여 보세요.'
            : increase
              ? '턱선의 폭을 살려 보려면 넓게 움직여 보세요.'
              : undefined,
    }
  }
  if (id === 'chinLength') {
    return {
      analysis: `눈꼬리 높이부터 턱끝까지의 길이는 얼굴 폭의 약 ${percent}%예요.`,
      goal: '정면에서 얼굴 아래쪽의 길이감을 비교해요.',
      direction:
        decrease && increase
          ? '얼굴 아래쪽을 짧게 보려면 짧게, 길이감을 살리려면 길게 움직여 보세요.'
          : decrease
            ? '얼굴 아래쪽을 짧게 보려면 턱끝을 짧게 조절해 보세요.'
            : increase
              ? '얼굴 아래쪽의 길이감을 살리려면 턱끝을 길게 조절해 보세요.'
              : undefined,
    }
  }
  const part = id === 'projection' ? '코끝' : '턱끝'
  const location = ratio < 0 ? '선보다 뒤에' : ratio > 0 ? '선보다 앞에' : '선 위에'
  return {
    analysis: `윗입술 기준점은 코끝과 턱끝을 이은 ${location} 있어요.`,
    goal: `옆모습에서 ${part} 위치에 따라 입매가 어떻게 보이는지 비교해요.`,
    direction:
      decrease && increase
        ? `${part}을 앞이나 뒤로 조금씩 움직여 보세요.`
        : decrease
          ? `${part}을 뒤로 조금 옮겨 보세요.`
          : increase
            ? `${part}을 앞으로 조금 옮겨 보세요.`
            : undefined,
  }
}

export function nextFaceAdjustments(
  profile: FaceProfile | null | undefined,
  controls: readonly PartControl[],
  weights: Readonly<Record<string, number>> | undefined,
  request: string | undefined,
  savedKeep = '',
  eyeInnerOpen = false,
) {
  if (!profile || !weights) return []
  const front = /정면|앞모습/.test(request ?? '')
  const side = /측면|옆모습|옆선/.test(request ?? '')
  const requestedKeeps = Array.from((request ?? '').matchAll(keepRequest), ([, parts]) => parts)
  const preserved = (savedKeep + ' ' + requestedKeeps.join(' ')).match(keepPart) ?? []
  const keep = preserved.map((part) => part.replace(/\s/g, ''))
  return comparisons
    .filter(({ view }) => front === side || (front ? 'front' : 'side') === view)
    .filter(({ id, part }) => {
      if (keep.includes(part)) return false
      if (id === 'eyeInner') return !keep.some((item) => /^(?:눈안쪽|앞트임)$/.test(item))
      if (id === 'projection') return !keep.some((item) => /^코끝(?:앞뒤|돌출)?$/.test(item))
      if (id === 'jawAngle') return !keep.some((part) => /사각턱|아래턱|턱선/.test(part))
      const name = id === 'chinProjection' ? '턱끝앞뒤' : '턱끝길이'
      return !keep.some((part) => part === name || /^(?:턱끝|아래턱|턱선)$/.test(part))
    })
    .flatMap(({ id }) => {
      const control = controls.find((candidate) => candidate.id === id)
      if (
        id === 'eyeInner' ? !eyeInnerOpen : !control || !adjustmentChoices(control, weights).length
      )
        return []
      const evidence = faceAdjustmentEvidence(profile, id)
      return evidence ? [evidence] : []
    })
}
