import type { Metadata } from 'next'
import { CaptureSession } from '@/features/capture/components/CaptureSession'

export const metadata: Metadata = {
  title: '휴대폰 촬영',
  // QR로만 들어오는 화면이다. 검색에 노출하지 않는다
  robots: { index: false, follow: false },
  // 주소에 남은 정보가 다른 사이트로 넘어가지 않게 한다(토큰은 fragment라 원래 안 넘어간다)
  referrer: 'no-referrer',
}

/**
 * 휴대폰 업로드 전용 세션. QR 주소는 `/m/capture#t={token}`이다(API-QR-01).
 * 토큰이 fragment에 있어 서버는 읽을 수 없다 — 페이지는 정적이고 교환은 브라우저가 한다.
 */
export default function CapturePage() {
  return <CaptureSession />
}
