'use client'

import dynamic from 'next/dynamic'

/**
 * 생성 대기 무대(three.js·React Three Fiber)를 나중에 들인다(S15P31B204-923).
 * 정적으로 import하면 three 전체가 대기 화면 첫 JS에 들어가 진행 바·문구가 늦게 뜬다.
 * 받는 동안에는 무대 자리만 비워 둔다. 진행 표시는 화면이 그대로 그린다(`BuildStage`도 실패하면 비운다).
 */
export const BuildStage = dynamic(() => import('./BuildStage').then((m) => m.BuildStage), {
  ssr: false,
  loading: () => null,
})
