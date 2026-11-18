import { NewHeadFlow } from '@/features/capture-link/NewHeadFlow'

export const metadata = { title: '새 모델' }

/**
 * 새 모델(PC). 촬영 시안과 같은 페이지 구성으로 촬영 안내 → 실제 QR 휴대폰 연결(SCR-16)을 제공한다.
 * 연결 상태는 API-QR-03을 3초마다 폴링한다(`useCaptureLink`).
 */
export default function NewFaceModelPage() {
  return <NewHeadFlow />
}
