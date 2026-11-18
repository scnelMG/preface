'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, MathUtils, Vector3, type Group } from 'three'

/** 안내 머리가 다음 방향으로 옮겨 가는 빠르기(지수 감쇠). 낮을수록 천천히 */
const EASE = 1.8
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { CAPTURE_POSES } from './capture-poses'

export default function CaptureGuideScene({
  step,
  immediate,
}: {
  step: number
  immediate: boolean
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6.5], fov: 32 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#ffffff', '#d5d0e0', 1.3]} />
      <directionalLight position={[-3, 4, 5]} intensity={1.8} />
      <directionalLight position={[3, 1, 3]} intensity={0.6} />
      <Suspense fallback={null}>
        <GuideHead step={step} immediate={immediate} />
      </Suspense>
    </Canvas>
  )
}
function GuideHead({ step, immediate }: { step: number; immediate: boolean }) {
  const gltf = useGLTF(SAMPLE_HEADS[1].meshUrl)
  const angles = useRef({ x: 0, y: 0, tilt: 0 })
  const invalidate = useThree((state) => state.invalidate)
  const { object, scale, position } = useMemo(() => {
    const object = clone(gltf.scene)
    const bounds = new Box3().setFromObject(object)
    const size = bounds.getSize(new Vector3())
    const scale = 3 / Math.max(size.x, size.y, size.z, 0.001)
    return { object, scale, position: bounds.getCenter(new Vector3()).multiplyScalar(-scale) }
  }, [gltf.scene])
  const pose = CAPTURE_POSES[step]
  useEffect(() => invalidate(), [step, immediate, invalidate])
  const head = useRef<Group>(null)
  useFrame(({ camera }, delta) => {
    const angle = angles.current
    // 천천히 자연스럽게(2026-10-30): 감쇠를 낮춰 1초 남짓에 걸쳐 부드럽게 다가간다
    const step = Math.min(delta, 0.05)
    angle.x = immediate ? pose.x : MathUtils.damp(angle.x, pose.x, EASE, step)
    angle.y = immediate ? pose.y : MathUtils.damp(angle.y, pose.y, EASE, step)
    angle.tilt = immediate ? pose.tilt : MathUtils.damp(angle.tilt, pose.tilt, EASE, step)
    // 위·아래는 휴대폰을 정면에 둔 채 고개를 든다·숙인다
    if (head.current) head.current.rotation.x = angle.tilt
    // 얼굴은 고정하고 촬영하는 카메라의 위치만 바꾼다.
    camera.position.set(
      -Math.sin(angle.y) * Math.cos(angle.x) * 6.5,
      -Math.sin(angle.x) * 6.5,
      Math.cos(angle.y) * Math.cos(angle.x) * 6.5,
    )
    camera.lookAt(0, 0, 0)
    if (
      Math.abs(angle.x - pose.x) + Math.abs(angle.y - pose.y) + Math.abs(angle.tilt - pose.tilt) >
      0.0001
    )
      invalidate()
  })
  return (
    <group ref={head}>
      <group scale={scale} position={position}>
        <primitive object={object} />
      </group>
    </group>
  )
}
