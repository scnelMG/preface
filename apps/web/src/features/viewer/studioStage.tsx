'use client'

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { PMREMGenerator, type Scene, type Texture, type WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 스튜디오 무대(2026-10-31). 편집실·작업실 3D(FaceViewer), 작업실 머리 고리, 시안 그림(draftRender)이 같은 빛을 쓴다.
 *
 * - 반사 환경: three 내장 RoomEnvironment(밝은 창·조명판이 있는 방)를 PMREM으로 구워 은은하게 깐다.
 *   피부에 소프트박스 같은 부드러운 하이라이트와 그늘 쪽 채움빛이 생긴다. 외부 HDR 파일을 받지 않는다(오프라인·CDN 없음).
 * - 바닥 그림자: 흉상 아래 부드러운 접지 그림자(drei ContactShadows). 머리가 바탕에 떠 보이지 않고 받침 위에 놓인 듯하다.
 * 세기는 기존 직접광(반구광 + 주광 + 보조광)을 해치지 않게 낮게 둔다.
 */

/** 반사 환경 세기. 어두운 무대는 테두리 빛이 따로 있어 더 낮게 */
export const STUDIO_ENV_INTENSITY = { light: 0.14, dark: 0.1 } as const

/** 렌더러 하나에 반사 환경 텍스처를 만든다(three 직접 사용: draftRender) */
export function createStudioEnvironment(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const texture = pmrem.fromScene(room, 0.04).texture
  room.dispose()
  pmrem.dispose()
  return texture
}

/** R3F 장면에 반사 환경을 깐다 */
export function StudioEnvironment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const texture = createStudioEnvironment(gl)
    const previous = setEnvironment(scene, texture)
    invalidate()
    return () => {
      setEnvironment(scene, previous)
      texture.dispose()
    }
  }, [gl, scene, invalidate])
  useEffect(() => {
    setEnvironmentIntensity(scene, intensity)
    invalidate()
  }, [scene, intensity, invalidate])
  return null
}

/** 장면의 반사 환경을 바꾸고 이전 것을 돌려준다 */
export function setEnvironment(scene: Scene, texture: Texture | null): Texture | null {
  const previous = scene.environment
  scene.environment = texture
  return previous
}

export function setEnvironmentIntensity(scene: Scene, intensity: number) {
  scene.environmentIntensity = intensity
}

/**
 * 흉상 아래 접지 그림자. `y`는 흉상 밑면 높이(장면 단위), `width`·`depth`는 그림자가 생기는 바닥 크기.
 * 다시 그릴 때마다 새로 굽는다(frameloop demand라 움직이거나 바뀔 때만 돈다. 모델이 늦게 와도 그림자가 따라온다).
 */
export function StageShadow({
  y,
  width = 4,
  depth = 3,
  opacity = 0.2,
}: {
  y: number
  width?: number
  depth?: number
  opacity?: number
}) {
  return (
    <ContactShadows
      position={[0, y, 0]}
      scale={[width, depth]}
      resolution={512}
      far={1.6}
      blur={3.2}
      opacity={opacity}
      color="#1a1622"
      frames={Infinity}
    />
  )
}
