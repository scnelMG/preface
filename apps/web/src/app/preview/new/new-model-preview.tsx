'use client'

import { useRef, useState } from 'react'
import {
  CheckIcon,
  DeviceMobileIcon,
  SunIcon,
  ScanIcon,
  ArrowCounterClockwiseIcon,
} from '@phosphor-icons/react'
import { QrCode } from '@/features/capture-link/QrCode'
import { PreviewNav } from '../preview-nav'
import { CapturePageFrame } from '@/features/capture-link/CapturePageFrame'

/** 실제 세션·인증을 변경하지 않는 촬영 연결 화면 시안이다. */
export function NewModelPreview() {
  const [connected, setConnected] = useState(false)
  const guide = useRef<HTMLDivElement>(null)
  return (
    <main className="preface-preview pf-flow pc-capture-page">
      <PreviewNav />
      <CapturePageFrame guideRef={guide}>
        <div className="pc-connection" aria-live="polite">
          {connected ? (
            <>
              <div className="pc-connected-icon">
                <CheckIcon size={28} />
              </div>
              <div>
                <h2>휴대폰이 연결됐어요.</h2>
                <p>휴대폰에서 촬영 안내를 확인하세요.</p>
              </div>
            </>
          ) : (
            <>
              <div className="pc-qr">
                <QrCode
                  value="http://127.0.0.1:3002/preview/new"
                  size={112}
                  label="화면 검토용 QR 코드"
                />
              </div>
              <div className="pc-mobile-icon">
                <DeviceMobileIcon size={30} />
              </div>
              <div>
                <h2 className="pc-desktop-copy">QR을 찍어 연결하세요.</h2>
                <h2 className="pc-mobile-copy">이 휴대폰으로 진행하세요.</h2>
                <p className="pc-desktop-copy">
                  휴대폰 기본 카메라로 스캔하면
                  <br />
                  촬영을 이어갈 수 있어요.
                </p>
                <p className="pc-mobile-copy">촬영 전에 아래 방향 안내를 확인하세요.</p>
              </div>
            </>
          )}
        </div>
        <button
          className="pf-primary pc-connect-demo pc-desktop-start"
          onClick={() => setConnected(!connected)}
        >
          {connected ? <ArrowCounterClockwiseIcon size={17} /> : <DeviceMobileIcon size={18} />}
          {connected ? '연결 대기 화면으로' : '연결된 화면 미리보기'}
        </button>
        <button
          className="pf-primary pc-connect-demo pc-mobile-start"
          onClick={() => {
            setConnected(true)
            guide.current?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
              block: 'start',
            })
          }}
        >
          <DeviceMobileIcon size={18} />
          촬영 안내 보기
        </button>
        <p className="pc-demo-note">
          Google 로그인 상태로 보는 로컬 시안이에요.
          <br />
          QR 연결과 촬영은 서버 복구 후 사용할 수 있어요.
        </p>
        <ul className="pc-capture-tips">
          <li>
            <SunIcon size={19} />
            <span>밝고 일정한 조명</span>
          </li>
          <li>
            <ScanIcon size={19} />
            <span>얼굴은 프레임 가운데</span>
          </li>
          <li>
            <DeviceMobileIcon size={19} />
            <span>휴대폰은 천천히 이동</span>
          </li>
        </ul>
      </CapturePageFrame>
    </main>
  )
}
