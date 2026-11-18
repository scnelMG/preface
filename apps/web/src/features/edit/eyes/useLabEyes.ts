'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EyeGeometryStatus } from '@/features/viewer/eyeRig'
import type { FaceViewerProps } from '@/features/viewer/types'
import { EYE_LIMIT_RULE, type EyeComboResult } from '@/features/viewer/useEyeLimits'
import {
  clampEyes,
  type EyeControl,
  type EyeLimits,
  type EyeReview,
  type EyeSelection,
  type EyeState,
} from './state'
import { useEyeEditor } from './useEyeEditor'

/** 아직 하나도 확인하지 않은 한계(모든 슬라이더가 확인 중) */
const NO_LIMITS: EyeLimits = {}
export const EYE_CONTROL_NAMES: Record<EyeControl, string> = {
  height: '라인 높이',
  crease: '접힘 깊이',
  inner: '앞트임',
  outer: '뒤트임',
  lower: '밑트임',
  upper: '윗트임',
}

/**
 * 실험실 화면의 눈 편집 묶음: 모델별 이력, 안전 한계(워커), 조합 검사, 기준점 준비 상태.
 * `viewer`는 FaceStage/FaceViewer의 `eyeEdit`로 그대로 넘긴다. 회색 형상은 사용자 화면에 쓰지 않는다.
 *
 * @param modelKey 이력 구분용(모델 + 파일 해시)
 * @param fileKey 안전 한계 캐시 키(파일 해시)
 * @param active 눈 탭을 연 동안만 한계를 계산한다(떠나면 멈추고 끝난 값은 남는다)
 * @param knownLimits 같은 엔진으로 미리 잰 한계(기본 모델). 판정 기준(`rule`)이 지금 엔진과 같을 때만 쓰고,
 *   그러면 눈 탭을 열자마자 슬라이더가 열린다(브라우저 계산은 모델 하나에 10초 이상 걸린다, -526).
 */
export function useLabEyes({
  modelKey,
  fileKey,
  review,
  active,
  knownLimits,
  onAdjusted,
}: {
  modelKey: string
  fileKey: string
  review: EyeReview
  active: boolean
  knownLimits?: { rule: string; limits: EyeLimits }
  onAdjusted?: (state: EyeState) => void
}) {
  const editor = useEyeEditor(modelKey)
  // 적용할 눈은 지금 양쪽뿐이다(한쪽만 고르는 L·R은 조작 카드 배치 정리 뒤에 다시 연다)
  const selection: EyeSelection = 'both'
  const [computed, setComputed] = useState<{ key: string; limits: EyeLimits }>()
  const onLimits = useCallback(
    (limits: EyeLimits) => setComputed({ key: modelKey, limits }),
    [modelKey],
  )
  // 워커가 없는 환경(테스트)은 한계를 계산하지 않고 전체 범위를 쓴다.
  const known = knownLimits?.rule === EYE_LIMIT_RULE ? knownLimits.limits : undefined
  const limits =
    typeof Worker === 'undefined'
      ? undefined
      : computed?.key === modelKey
        ? computed.limits
        : (known ?? NO_LIMITS)
  const { state, replace } = editor
  const [check, setCheck] = useState<{ checking: boolean; note?: string }>({ checking: false })
  const onChecking = useCallback(
    (checking: boolean) =>
      setCheck((previous) => (checking ? { checking } : { ...previous, checking })),
    [],
  )
  const onCombo = useCallback(
    ({ state: lowered, control }: EyeComboResult) => {
      if (lowered) {
        replace(lowered)
        onAdjusted?.(lowered)
      }
      setCheck({
        checking: false,
        note: lowered
          ? `다른 조절과 함께 쓰면 형상이 깨져서 ${EYE_CONTROL_NAMES[control]} 값을 낮췄어요.`
          : undefined,
      })
    },
    [replace, onAdjusted],
  )
  useEffect(() => {
    if (!limits) return
    const clamped = clampEyes(state, limits)
    if (clamped !== state) replace(clamped)
  }, [limits, state, replace])
  const [geometry, setGeometry] = useState<EyeGeometryStatus>({
    ready: false,
    changed: 0,
    message: '눈 기준점을 확인하고 있어요.',
  })
  const onStatus = useCallback(
    (next: EyeGeometryStatus) =>
      setGeometry((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      ),
    [],
  )
  const viewer: NonNullable<FaceViewerProps['eyeEdit']> = {
    state,
    review,
    onStatus,
    limitsKey: active ? fileKey : undefined,
    onLimits,
    knownLimits: known,
    committed: editor.committed,
    onChecking,
    onCombo,
  }
  const note = !geometry.ready
    ? geometry.message
    : check.checking
      ? '다른 조절과의 조합을 확인하고 있어요.'
      : check.note
  return { editor, selection, limits, geometry, note, viewer }
}
