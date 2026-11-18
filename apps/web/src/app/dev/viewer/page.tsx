import { notFound } from 'next/navigation'
import { PlaygroundLoader } from './PlaygroundLoader'

export const metadata = { title: '3D 뷰어 (개발용)' }

/**
 * 개발용 확인 페이지(S15P31B204-276). 3D 뷰어·시점·비교·코 파라미터 반영을 손으로 확인한다.
 * 운영 빌드에서는 404다.
 */
export default function ViewerDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <PlaygroundLoader />
}
