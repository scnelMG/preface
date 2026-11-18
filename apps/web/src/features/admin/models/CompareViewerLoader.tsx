'use client'

import dynamic from 'next/dynamic'

/** three.js·React Three Fiber는 서버에서 돌 수 없다. 관리자 비교 뷰어도 `ssr: false`로 들인다 */
export const CompareViewer = dynamic(() => import('./CompareViewer'), {
  ssr: false,
  loading: () => <div className="size-full" aria-busy="true" aria-label="3D 뷰어 준비 중" />,
})
