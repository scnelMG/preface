'use client'

import { useLayoutEffect, useRef } from 'react'
import { Button, Modal } from '@/shared/ui'
import { isSurveyOpen, useSurveyOpen } from './schedule'
import { clearShown, markShown, wasShown } from './shownOnce'
import { SURVEY_URL } from './SurveyPopup'

const AFTER_DONE_KEY = 'preface.survey.v2.afterDone'

/** 설문 기간(마감 전, -851)이고 이 기기에서 아직 완료 뒤 설문을 권하지 않았는지 */
export function shouldAskSurveyAfterDone(): boolean {
  return isSurveyOpen() && !wasShown(AFTER_DONE_KEY)
}

/** 완료 뒤 설문을 권했다고 남긴다. 창을 여는 순간 부른다 */
export function markSurveyAfterDone(): void {
  markShown(AFTER_DONE_KEY)
}

/** 기록을 지운다(테스트·다시 보기용) */
export function clearSurveyAfterDone(): void {
  clearShown(AFTER_DONE_KEY)
}

/**
 * 1차 배포 설문 안내(S15P31B204-434 → -844). 편집실에서 `완료`를 처음 누르면 작업실로 가기 전에 한 번 띄운다 —
 * 수정을 마친 때라 설문을 권하기 좋다. 예전에는 `시안 저장` 이름 창이 저장에 성공할 때마다 이 내용으로 바뀌었는데,
 * 이름 창을 걷으면서(-844) 기기별 한 번(`shownOnce`)으로 바꿨다. 닫거나 참여하면 부른 쪽이 작업실로 보낸다.
 * 설문 마감(`SURVEY_ENDS_AT`, -851) 뒤에는 묻지 않는다. 창을 띄운 채 마감을 넘기면 그리지 않고
 * 바로 `onClose`를 불러 작업실로 보낸다(-851의 옛 `SurveyAfterSave`와 같은 방식, 그리기 전에 닫도록 layout effect로 한 번만).
 * 2차 배포 때 이 파일과 `SimulationLab`의 사용처를 지운다.
 */
export function SurveyAfterDone({ open, onClose }: { open: boolean; onClose: () => void }) {
  const surveyOpen = useSurveyOpen()
  const closedForEnd = useRef(false)

  useLayoutEffect(() => {
    if (surveyOpen || isSurveyOpen() || closedForEnd.current) return
    closedForEnd.current = true
    onClose()
  }, [surveyOpen, onClose])

  function participate() {
    window.open(SURVEY_URL, '_blank', 'noopener,noreferrer')
    onClose()
  }

  if (!surveyOpen) return null

  return (
    <Modal open={open} onClose={onClose} title="시안을 저장했어요">
      <div className="flex flex-col">
        <p className="mt-(--space-4) text-[14.5px] leading-[1.6] break-keep text-ink-2">
          수정해 보신 소감을 설문으로 들려주세요. 참여하신 분께 다양한 경품을 드려요.
        </p>
        <div className="mt-(--space-24) grid grid-cols-2 gap-(--space-8)">
          <Button variant="secondary" trailingIcon={null} onClick={onClose} className="w-full">
            닫기
          </Button>
          <Button variant="ink" trailingIcon={null} onClick={participate} className="w-full">
            설문조사 하러 가기
          </Button>
        </div>
      </div>
    </Modal>
  )
}
