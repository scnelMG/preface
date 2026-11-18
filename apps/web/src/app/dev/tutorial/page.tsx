import { notFound } from 'next/navigation'
import { TrialLoader } from './TrialLoader'

export const metadata = { title: '기본 모델 체험 튜토리얼 (개발용)' }

/**
 * 개발용 확인 페이지(S15P31B204-305). 기본 모델 체험과 첫 사용 튜토리얼을 손으로 확인한다.
 * 메인(-277)·3D 생성 대기(-194)에 붙이기 전까지 여기서 본다. 운영 빌드에서는 404다.
 */
export default function TutorialDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <TrialLoader />
}
