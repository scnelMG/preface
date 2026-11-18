'use client'

import { useCallback } from 'react'
import { summarizeEdit, type EditFeedbackKind, type SliderChange } from '../editLogic'
import { feedbackToast } from '../feedbackToast'
import { useEditStore } from '../store'
import type { MorphParameterCatalog } from '../types'

/**
 * 저장된 편집을 화면 아래 토스트 한 줄로 알린다. 되돌리기·앞으로 가기는 `…로 되돌렸어요` · `…로 다시 바꿨어요`,
 * 슬라이더 조절은 안전 범위(한계)에 걸렸을 때만 `…까지만 바꿀 수 있어요` 등을 띄운다(규칙은 editLogic `summarizeEdit`).
 * 편집 알림은 한 번에 하나다(feedbackToast). 잇달아 저장되면 앞 알림을 걷고 새 알림만 남긴다.
 *
 * `catalog`는 슬라이더와 같은 카탈로그(모델별 승인 범위를 씌운 것)를 넘긴다. 그래야 알림의 %가 슬라이더 %와 같다.
 * null이면 실패한 요청이라 알리지 않는다.
 *
 * 띄운(또는 띄울) 문구를 돌려준다. `shown`을 넘기면 문구가 그것과 같을 때 다시 띄우지 않는다
 * (손을 뗄 때 띄운 알림과 저장 응답 뒤 문구가 같으면 한 번만 보이게, S15P31B204-852).
 */
export function useChangeSummary(catalog: MorphParameterCatalog | null) {
  return useCallback(
    (
      changes: readonly SliderChange[] | null | undefined,
      kind: EditFeedbackKind = 'change',
      shown?: string | null,
    ): string | null => {
      if (!changes) return null
      const weights = useEditStore.getState().morphState.weights
      const message = summarizeEdit(catalog, changes, kind, weights)
      if (message && message !== shown) feedbackToast(message)
      return message
    },
    [catalog],
  )
}
