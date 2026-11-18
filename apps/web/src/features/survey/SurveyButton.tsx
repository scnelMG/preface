'use client'

import { GiftIcon } from '@phosphor-icons/react'
import { useState, useSyncExternalStore } from 'react'
import { Button, Icon, Modal } from '@/shared/ui'
import { useSurveyOpen } from './schedule'
import { SURVEY_URL } from './SurveyPopup'

/**
 * 1차 배포 설문 참여 버튼(S15P31B204-428). 작업실 수정 화면 제목 옆에 둔다 — 3D를 수정해 본 뒤 설문하도록.
 * 참여 여부는 외부 Forms라 알 수 없어서, 1차 배포 기간에는 늘 보인다. 2차 배포 때 `SurveyPopup`과 같이 지운다.
 *
 * 모양(refine.css pf-survey-chip): 보라(accent)로 채운 알약 + 흰 글자 '설문 참여' + 흰 선물 아이콘(경품) + 작은 X, 테두리를 도는 흰 빛.
 * 2026-11-11(S15P31B204-770)에 눈에 잘 띄게 키우고 채웠다(전에는 투명 유리 알약 + 보라 빛, 2026-10-31).
 * - 선물 아이콘이 경품을 알리므로 마우스 설명은 두지 않는다. ✦는 'AI'로 읽혀 쓰지 않는다.
 * - X는 바로 숨기지 않고 확인을 받는다. 숨기면 이 기기에만 남는다(localStorage). 확인 창에서 바로 참여할 수도 있다.
 * - 좁은 화면은 글자를 '설문'으로 줄인다.
 * - 설문 마감(`SURVEY_ENDS_AT`, 2026-11-17 0시 KST)부터는 그리지 않는다(S15P31B204-851). 행사 종료 뒤 정리.
 */

const HIDDEN_KEY = 'preface.survey.hidden'
const HIDDEN_EVENT = 'preface:survey-hidden'

function readHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function subscribeHidden(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(HIDDEN_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(HIDDEN_EVENT, onChange)
  }
}

function participate() {
  window.open(SURVEY_URL, '_blank', 'noopener,noreferrer')
}

export function SurveyButton() {
  const surveyOpen = useSurveyOpen()
  const hidden = useSyncExternalStore(subscribeHidden, readHidden, () => false)
  const [confirming, setConfirming] = useState(false)

  function hide() {
    try {
      localStorage.setItem(HIDDEN_KEY, '1')
    } catch {
      // 저장소를 못 써도 이번 화면에서는 숨긴다
    }
    setConfirming(false)
    window.dispatchEvent(new Event(HIDDEN_EVENT))
  }

  if (!surveyOpen || hidden) return null

  return (
    <>
      <span className="pf-survey-chip">
        <button
          type="button"
          onClick={participate}
          aria-label="설문 참여하기(경품, 새 탭에서 열림)"
          className="pf-survey-main"
        >
          <span className="max-md:hidden">설문 참여</span>
          <span className="md:hidden">설문</span>
          <GiftIcon size={16} weight="fill" aria-hidden="true" className="pf-survey-gift" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="설문 버튼 숨기기"
          className="pf-survey-close"
        >
          <Icon name="X" size={12} />
        </button>
      </span>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="설문 버튼을 숨길까요?">
        <p className="type-lead break-keep text-ink-2">
          숨기면 이 기기에서는 다시 보이지 않아요. 써 보신 느낌을 알려 주시면 서비스를 다듬는 데 큰
          도움이 돼요.
        </p>
        <div className="mt-(--space-24) grid grid-cols-2 gap-(--space-8)">
          <Button variant="secondary" trailingIcon={null} onClick={hide} className="w-full">
            숨기기
          </Button>
          <Button
            variant="ink"
            trailingIcon={null}
            onClick={() => {
              setConfirming(false)
              participate()
            }}
            className="w-full"
          >
            설문 참여하기
          </Button>
        </div>
      </Modal>
    </>
  )
}
