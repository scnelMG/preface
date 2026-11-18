'use client'

import { useEffect, useState } from 'react'
import { Button, Modal } from '@/shared/ui'
import { useSurveyOpen } from './schedule'
import { clearShown, markShown, wasShown } from './shownOnce'

/**
 * 1차 배포 사용자 설문 안내(S15P31B204-417 → -428). 3D가 완성되면 "수정해 본 뒤 설문에 참여해 달라"고 한 번 안내한다.
 * 설문 링크는 여기서 열지 않는다 — 수정을 써 보기 전에 설문을 받으면 순서가 맞지 않아서, 참여는 작업실 수정 화면의
 * `SurveyButton`에서 한다.
 * 2차 배포 때 뺀다 — 이 폴더와 사용처(`ReconstructionWaiting`의 `<SurveyPopup>`, `SimulationLab`의 `<SurveyButton>`·`<SurveyAfterDone>`)만 지우면 된다.
 *
 * - 띄운 기록은 기기별 localStorage에 한 번만 남긴다(사용자당 1회). 3D를 다시 만들어도 같은 안내를 또 띄우지 않는다.
 *   -417 때의 작업별 기록(`preface.survey.v1.<jobId>`)과 키가 달라, 이미 옛 팝업을 본 기기에도 새 안내는 한 번 뜬다.
 *   저장소가 막혀 있으면 이 탭의 메모리에만 기억한다(`shownOnce`).
 * - 처음 그릴 때 이미 띄웠는지 읽어 둔다. 띄우자마자 기록을 쓰므로, 매번 다시 읽으면 바로 닫혀 버린다.
 * - 설문 마감(`SURVEY_ENDS_AT`, 2026-11-17 0시 KST)부터는 띄우지 않고, 떠 있던 것도 닫는다(S15P31B204-851). 행사 종료 뒤 정리.
 */
export const SURVEY_URL = 'https://forms.gle/GLXzG652SNDHyLSYA'

const NOTICE_KEY = 'preface.survey.v2.notice'

/** 안내 기록을 지운다(테스트·다시 보기용) */
export function clearSurveyNotice(): void {
  clearShown(NOTICE_KEY)
}

export function SurveyPopup({ done }: { done: boolean }) {
  const [seen] = useState(() => wasShown(NOTICE_KEY))
  const [closed, setClosed] = useState(false)
  const surveyOpen = useSurveyOpen()
  const open = surveyOpen && done && !seen && !closed

  useEffect(() => {
    if (open) markShown(NOTICE_KEY)
  }, [open])

  return (
    <Modal open={open} onClose={() => setClosed(true)} title="3D가 완성됐어요">
      {/* 사이트 말투(~해요)와 본문 글자 크기에 맞췄다(2026-10-31) */}
      <p className="text-[14.5px] leading-[1.6] break-keep text-ink-2">
        작업실에서 직접 바꿔 본 뒤 설문에 참여해 주세요. 다양한 경품을 준비했어요.
      </p>
      <div className="mt-(--space-24) grid grid-cols-2 gap-(--space-8)">
        <Button
          variant="secondary"
          trailingIcon={null}
          onClick={() => setClosed(true)}
          className="w-full"
        >
          닫기
        </Button>
        <Button variant="ink" href="/studio" trailingIcon={null} className="w-full">
          작업실로 가기
        </Button>
      </div>
    </Modal>
  )
}
