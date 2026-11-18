'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { DeviceMobileIcon } from '@phosphor-icons/react'
import { isMobileDevice } from '@/features/capture/device'
import { openPage, sameDeviceCaptureUrl } from '@/features/capture/linkToken'
import { CAPTURE_GUIDE } from '@/features/capture-guide/guideContent'
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
} from '@/features/notifications/browser'
import { Modal } from '@/shared/ui'
import { CapturePageFrame } from './CapturePageFrame'
import { CaptureLinkPanel } from './CaptureLinkPanel'
import { useCaptureLink } from './useCaptureLink'

/**
 * 새 모델(PC) — 휴대폰 3D 촬영 안내와 실제 연결 상태를 한 페이지에서 보여준다.
 *
 * 1. 촬영 안내. `영상 촬영하기`를 누르면
 * 2. 같은 페이지의 연결 영역에 QR(SCR-16)을 발급한다(API-QR-01 비고).
 * 3. 휴대폰 업로드가 끝나면(QR-03 `UPLOADED`) 3D 생성 대기 화면(SCR-08)으로 넘어간다(FN-CAP-04 수용 6).
 *
 * 닫기를 누르면 아직 아무도 안 쓴 QR은 끊고 내 작업실로 돌아간다.
 *
 * `영상 촬영하기`를 누를 때 브라우저 알림 권한을 묻는다(FN-REC-03 "첫 복원에서 알림 권한 요청").
 * - 복원을 시작하는 첫 클릭이고, 완료를 기다릴 브라우저가 바로 이 PC 탭이다(휴대폰은 촬영·업로드만 한다).
 * - 권한 요청은 클릭 안에서만 되므로 화면 진입 때가 아니라 여기서 부른다.
 * - 'default'(아직 안 물음)일 때만 묻는다. 허용·거부가 정해졌거나 미지원이면 묻지 않는다.
 *   답을 기다리지 않고 QR로 넘어간다. 거부해도 막는 것은 없다(인앱 알림만 쓴다, REQ-F-08).
 *
 * 휴대폰에서 열면 QR이 쓸모없다(S15P31B204-457). 가이드·QR 없이 같은 촬영 링크를 바로 발급해 이 탭에서 휴대폰 촬영 화면
 * (`/m/capture#t=…&self=1`)으로 넘어간다. 촬영 화면에 같은 가이드(SCR-05)가 있다. 발급이 실패하면(동의 없음·진행 중 작업)
 * 기존 오류 모달로 안내한다.
 */
export function NewHeadFlow() {
  const router = useRouter()
  // 서버 렌더에서는 기기를 모른다(null). 정해지기 전에는 아무것도 그리지 않는다
  const mobile = useSyncExternalStore(subscribeNothing, isMobileDevice, () => null)
  const [step, setStep] = useState<'guide' | 'qr'>('guide')
  // cacheComponents는 떠난 화면의 상태를 남긴다(<Activity hidden>). 그대로 두면 다시 "머리 추가"를 눌렀을 때
  // 가이드를 건너뛰고 QR부터 보인다. 화면을 떠날 때 가이드로 되돌린다(Next 가이드 "Preserving UI state")
  useLayoutEffect(() => () => setStep('guide'), [])
  const { view, regenerate, disconnect, release } = useCaptureLink({
    enabled: mobile === true || step === 'qr',
    onUploaded: (jobId) => router.replace(`/reconstructions/${encodeURIComponent(jobId)}`),
  })

  // 휴대폰: 링크가 나오면 바로 이 탭에서 촬영 화면으로
  const directUrl =
    mobile && view.kind === 'ready' && view.status === 'WAITING'
      ? sameDeviceCaptureUrl(view.link.qrUrl, window.location.origin)
      : null
  useEffect(() => {
    if (directUrl) openPage(directUrl)
  }, [directUrl])

  const startCapture = () => {
    if (getBrowserNotificationPermission() === 'default') {
      // requestPermission은 첫 await 전에 동기로 불려 클릭의 사용자 동작 안에 든다
      void requestBrowserNotificationPermission()
    }
    setStep('qr')
  }

  const close = () => {
    release()
    router.push('/studio')
  }

  if (mobile === null) return null
  if (mobile) {
    if (view.kind !== 'failed') {
      return (
        <p role="status" className="type-kr-body-13-regular-lh16p9 mt-(--space-24) text-text-body">
          촬영 화면으로 이동하는 중이에요…
        </p>
      )
    }
    return (
      <Modal open onClose={close} title="휴대폰으로 촬영해요">
        <CaptureLinkPanel view={view} onRegenerate={regenerate} onDisconnect={disconnect} />
      </Modal>
    )
  }

  return (
    <CapturePageFrame onClose={close}>
      {step === 'guide' ? (
        <div className="pc-capture-preparation" aria-label={CAPTURE_GUIDE.title}>
          <button className="pf-primary pc-connect-demo" onClick={startCapture}>
            <DeviceMobileIcon size={18} />
            {CAPTURE_GUIDE.pcNext}
          </button>
          <p className="pc-demo-note">휴대폰으로 QR을 찍으면 바로 시작돼요.</p>
        </div>
      ) : (
        <CaptureLinkPanel
          variant="page"
          view={view}
          onRegenerate={regenerate}
          onDisconnect={disconnect}
        />
      )}
    </CapturePageFrame>
  )
}

/** 기기 정보는 바뀌지 않는다 */
function subscribeNothing() {
  return () => {}
}
