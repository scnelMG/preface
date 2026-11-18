'use client'

import dynamic from 'next/dynamic'

/**
 * 클라이언트 전용 모듈을 들여오는 자리.
 *
 * 3D(three.js·React Three Fiber)·카메라(`getUserMedia`)·MediaPipe는 서버에 없는 API를 쓴다.
 * `ssr: false`를 주면 서버 렌더링에서 빠지고 서버 번들에도 들어가지 않는다.
 * 타입은 three를 쓰지 않는 `./types`에 있다.
 *
 * 같은 방식으로 분리할 것:
 * - 촬영 화면의 카메라·MediaPipe FaceLandmarker
 * - 편집 화면의 제어점 드래그
 */

export const FaceViewer = dynamic(() => import('./FaceViewer'), {
  ssr: false,
  // 코드 조각을 받는 동안. GLB 로딩 표시는 FaceViewer 안에서 한다
  loading: () => <div className="size-full" aria-busy="true" aria-label="3D 뷰어 준비 중" />,
})
