import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SharedViewer } from '@/features/share/SharedViewer'

/**
 * 얼굴 데이터라 검색 색인을 막고, 토큰이 든 주소가 3D 파일(S3) 요청의 Referer로 새지 않게 한다.
 * 메신저 미리보기 이미지(og:image)는 두지 않는다 — 얼굴 썸네일이 미리보기 서버에 캐시되면 공유를 끝내도 지울 수 없다.
 */
export const metadata: Metadata = {
  title: '공유받은 시안',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function SharedSimulationPage({ params }: PageProps<'/s/[token]'>) {
  return (
    <Suspense fallback={<div className="h-dvh animate-pulse bg-bg-stone" aria-busy="true" />}>
      <SharedViewerFromParams params={params} />
    </Suspense>
  )
}

async function SharedViewerFromParams({ params }: { params: PageProps<'/s/[token]'>['params'] }) {
  const { token } = await params
  return <SharedViewer key={token} token={token} />
}
