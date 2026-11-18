'use client'

import { useState } from 'react'
import { LIVE_CAPTURE_COPY } from '@/features/live-capture/LiveCapture'
import { isLiveCaptureSupported } from '@/features/live-capture/recorder'
import { Button, Modal } from '@/shared/ui'
import { MOBILE_CAPTURE_GUIDE as COPY } from '@/features/capture-guide/guideContent'
import { CaptureMotionPlayer } from '@/features/capture-guide/CaptureMotionGuide'
import { PrepCards } from '@/features/capture-guide/CaptureFlowParts'
import '@/features/capture-guide/capture-flow.css'

/**
 * SCR-05 촬영 가이드 · 업로드 전용 세션 ② 촬영 / Mobile (FN-CAP-01·REQ-F-04).
 * "영상 촬영하기"가 웹 실시간 촬영(`features/live-capture`, S15P31B204-619)을 연다. 촬영 중에는 화면·음성으로 안내하므로,
 * 이 화면은 동작을 미리 보여 주고 준비물을 확인시키는 데 그친다.
 *
 * PC 새 모델 화면과 같은 시연 영상·문구·준비 그림을 쓴다(`features/capture-guide`). 구성: 제목 → 시연 →
 * 화면 아래에 붙은 버튼 → 도움말. 모양은 capture-flow.css의 `.pf-mcap*`.
 *
 * "찍기 전에"(준비 카드)는 본문에 두지 않고, 들어오자마자 아래에서 올라오는 팝업으로 먼저 보여 준다(S15P31B204-566).
 * 닫는 길은 [확인했어요] 하나다(X·배경 누르기 없음). 닫으면 시연 영상을 처음부터 다시 튼다(`key`로 새로 만든다).
 * 촬영 안내에 들어올 때마다 띄운다. 녹화 화면에서 돌아오거나 휴대폰 종류를 바꿔도 다시 본다(-882, 사용자 결정 2026-11-15).
 *
 * 브라우저가 웹 녹화를 못 하면 촬영 버튼 대신 다른 브라우저로 열라는 안내 문구를 보여 준다. 업로드는 웹 녹화로만 한다(S15P31B204-929).
 */
export function CaptureGuide({
  onCapture,
  liveSupported,
}: {
  /** 웹 실시간 촬영을 연다 */
  onCapture: () => void
  /** 웹 녹화 가능 여부. 생략하면 브라우저 기능으로 판단한다 */
  liveSupported?: boolean
}) {
  const [supported] = useState(() => liveSupported ?? isLiveCaptureSupported())
  const [prepOpen, setPrepOpen] = useState(true)
  // 팝업을 닫을 때마다 늘려 시연 영상을 처음부터 다시 튼다
  const [playRound, setPlayRound] = useState(0)
  const confirmPrep = () => {
    setPrepOpen(false)
    setPlayRound((round) => round + 1)
  }
  return (
    <div className="pf-mcap">
      <header className="pf-mcap-intro">
        <h1>{COPY.title}</h1>
        <p>{COPY.intro}</p>
      </header>

      <div className="pf-mcap-player">
        <CaptureMotionPlayer key={playRound} />
        <button type="button" className="pf-mcap-prep-reopen" onClick={() => setPrepOpen(true)}>
          {COPY.preparationReopen}
        </button>
      </div>

      <Modal
        open={prepOpen}
        onClose={confirmPrep}
        title={COPY.preparationTitle}
        placement="sheet"
        dismissible={false}
      >
        <div className="pf-mcap-prep">
          <PrepCards />
        </div>
        <Button
          variant="ink"
          trailingIcon={null}
          className="mt-(--space-24) w-full"
          onClick={confirmPrep}
        >
          {COPY.preparationConfirm}
        </Button>
      </Modal>

      {/* 버튼은 화면 아래에 붙여 어디까지 내려 읽든 바로 누를 수 있게 한다 */}
      <div className="pf-mcap-dock">
        {supported ? (
          <Button variant="ink" className="w-full" onClick={onCapture}>
            {COPY.capture}
          </Button>
        ) : (
          <p className="pf-mcap-unsupported" role="alert">
            {LIVE_CAPTURE_COPY.unsupported}
          </p>
        )}
      </div>
      {supported ? <p className="pf-mcap-help">{COPY.cameraHelp}</p> : null}
    </div>
  )
}
