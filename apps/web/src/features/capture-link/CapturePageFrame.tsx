'use client'

import type { ReactNode, RefObject } from 'react'
import { PrepCards } from '@/features/capture-guide/CaptureFlowParts'
import { CaptureMotionGuide } from '@/features/capture-guide/CaptureMotionGuide'
import { Icon } from '@/shared/ui'
import '@/app/preview/flow.css'
import '@/features/capture-guide/capture-flow.css'

/**
 * 촬영 시안과 실서비스가 공유하는 레이아웃. 연결 상태와 액션만 각각 전달한다.
 *
 * 2026-10-31 다시 짬(한 화면에 다 보이게): 왼쪽 열은 제목 → 촬영 순서 목록(영상과 함께 움직임) → 지금 할 행동
 * (영상 촬영하기 또는 QR), 오른쪽 열은 화면의 주인공인 시연 영상 → 그 아래 찍기 전 준비 그림 넷. 큰 화면에서는 스크롤 없이 본다.
 * 흐름 단계 표시(준비 → 연결 → …)는 두지 않는다: 촬영 순서(1~5)와 번호가 겹쳐 헷갈렸다. 다음 단계는 버튼 아래 한 줄이 알린다.
 */
export function CapturePageFrame({
  children,
  onClose,
  guideRef,
}: {
  children: ReactNode
  onClose?: () => void
  guideRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="preface-preview pf-flow pf-connected-capture pf-cap">
      {onClose && (
        <button className="pf-cap-close" aria-label="닫기" onClick={onClose}>
          <Icon name="X" size={20} />
        </button>
      )}
      <CaptureMotionGuide
        guideRef={guideRef}
        intro={
          <header className="pf-cap-intro">
            <h1 id="pc-capture-title">휴대폰으로 얼굴을 담아요</h1>
            <p>얼굴은 그대로, 휴대폰만 반원을 그리며 옮겨요.</p>
          </header>
        }
        actions={children}
        after={
          <section className="pf-cap-prep" aria-labelledby="pf-cap-prep-title">
            <h2 id="pf-cap-prep-title">찍기 전에</h2>
            <PrepCards />
          </section>
        }
      />
    </div>
  )
}
