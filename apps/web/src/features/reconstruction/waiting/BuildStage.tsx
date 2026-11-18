'use client'

import { Component, Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { Face } from '@/features/landing/stage/Face'
import { useTheme } from '@/shared/theme/theme'
import type { ReconstructionJob } from '../types'

/**
 * 3D 생성 대기 무대(2026-10-31). 랜딩과 같은 머리 장면을 스크롤 대신 서버 단계(API-REC-02 stageIndex)로 움직인다.
 *
 *   대기·1단계 프레임 고르기·2단계 입력 품질 확인 → 468개 점
 *   3단계 3D 얼굴 만들기 → 점 위로 회색 형상이 덮인다
 *   4단계 마무리 → 피부색이 들어오는 중 · 완성 → 피부
 *
 * 단계 번호만 쓰고 %·예상 시간은 만들지 않는다. 인물은 예시(메타휴먼 가상 인물, 로컬 시안 임시)이며 화면에 밝힌다.
 * 머리 파일이 없거나 WebGL이 안 되면 무대만 비고 진행 표시는 그대로 남는다.
 */
export function stageProgress(job: ReconstructionJob | null): number {
  if (!job) return 1.3
  if (job.status === 'SUCCEEDED') return 3.6
  switch (job.stageIndex) {
    case 3:
      return 2.5
    case 4:
      return 3.12
    case 2:
      return 1.6
    default:
      return 1.3
  }
}

export function BuildStage({ job }: { job: ReconstructionJob | null }) {
  const light = useTheme() === 'light'
  return (
    <StageBoundary>
      <Canvas
        className="pf-build-canvas"
        camera={{ fov: 22, near: 0.01, far: 50, position: [0, 0.02, 1.3] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping }}
      >
        <hemisphereLight args={[0xffffff, light ? 0xcfcbc4 : 0x222226, light ? 0.8 : 0.35]} />
        <directionalLight position={[-1.2, 1.0, 1.6]} intensity={2.2} color={0xfff3e6} />
        <directionalLight
          position={[1.4, 0.8, -1.2]}
          intensity={light ? 1.2 : 2.4}
          color={0xdfe6ff}
        />
        <directionalLight
          position={[-1.4, 0.6, -1.0]}
          intensity={light ? 0.7 : 1.4}
          color={0xdfe6ff}
        />
        <Suspense fallback={null}>
          <Face light={light} progress={stageProgress(job)} bald />
        </Suspense>
      </Canvas>
    </StageBoundary>
  )
}

class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
