'use client'

import dynamic from 'next/dynamic'

/**
 * 확인 페이지 전체를 클라이언트에서만 그린다. 합성 GLB를 만들려고 three(GLTFExporter)를 불러오기 때문에
 * 서버 번들에 three 조각이 생기지 않게 한다.
 */
export const PlaygroundLoader = dynamic(
  () => import('./ViewerPlayground').then((mod) => mod.ViewerPlayground),
  { ssr: false },
)
