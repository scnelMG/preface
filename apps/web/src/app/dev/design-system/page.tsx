import { notFound } from 'next/navigation'
import { Showcase } from './Showcase'

export const metadata = { title: '디자인 시스템 (개발용)' }

/**
 * 개발용 확인 페이지. Figma Foundations · v3와 나란히 놓고 비교한다.
 * 운영 빌드에서는 404다.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Showcase />
}
