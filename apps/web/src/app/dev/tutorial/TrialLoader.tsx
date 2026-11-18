'use client'

import dynamic from 'next/dynamic'

/** 합성 GLB를 만들려고 three(GLTFExporter)를 불러온다. 서버 번들에 넣지 않으려고 클라이언트에서만 그린다 */
export const TrialLoader = dynamic(
  () => import('./TrialPlayground').then((mod) => mod.TrialPlayground),
  { ssr: false },
)
