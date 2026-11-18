'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Line, RoundedBox, useGLTF } from '@react-three/drei'
import {
  Box3,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Group,
  type Object3D,
} from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { CAPTURE_POSES } from './capture-poses'

/**
 * 촬영하는 사람을 옆에서 본 장면(2026-10-31). 휴대폰 화면(1인칭, capture-guide-scene)과 나란히 같은 단계를 보여 준다.
 *
 * - 사람은 점토 질감 마네킹(기본 모델 머리·어깨 + 쭉 뻗은 팔). 실제 얼굴 질감은 쓰지 않는다
 * - 휴대폰은 머리 둘레를 팔 길이만큼 떨어져 돈다. 위치는 1인칭 장면의 카메라와 같은 각도(pose.x·y)라 두 화면이 맞는다
 * - 왼쪽은 한 손, 첫 정면에서 반대 손으로 바꿔 잡고(팔이 반대 어깨로 옮겨 간다), 위·아래는 휴대폰을 둔 채 고개만 움직인다
 * - 휴대폰이 지나는 길(왼쪽 ↔ 오른쪽 호)은 옅은 점선으로
 */

const EASE = 1.8
const CLAY = '#e9e5e0'
/** 팔 길이(머리 가운데에서 휴대폰까지). 머리·어깨 높이를 3으로 맞춘 단위 */
const REACH = 2.55
/** 휴대폰을 드는 손: 첫 정면(손 바꿔 잡기)까지는 한쪽, 그 뒤로는 반대쪽 */
const holdSide = (step: number) => (step === 0 ? -1 : 1)
/** 손은 휴대폰 아래쪽을 쥔다 */
const HAND_BELOW_PHONE = new Vector3(0, -0.36, 0)

export default function CaptureArmScene({ step, immediate }: { step: number; immediate: boolean }) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [5.6, 2.9, 6.8], fov: 30 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#ffffff', '#cfc9dc', 1.15]} />
      <directionalLight position={[3, 5, 4]} intensity={1.7} />
      <directionalLight position={[-4, 2, -3]} intensity={0.7} color="#e7e0ff" />
      <Suspense fallback={null}>
        <Person step={step} immediate={immediate} />
      </Suspense>
    </Canvas>
  )
}

function Person({ step, immediate }: { step: number; immediate: boolean }) {
  const gltf = useGLTF(SAMPLE_HEADS[1].meshUrl)
  const invalidate = useThree((state) => state.invalidate)
  const camera = useThree((state) => state.camera)

  // 기본 모델을 점토 한 가지 색으로(질감·눈 색 없이 형태만)
  const { bust, scale, offset, head, shoulder, floor } = useMemo(() => {
    const bust: Object3D = clone(gltf.scene)
    const clay = new MeshStandardMaterial({ color: CLAY, roughness: 0.82, metalness: 0 })
    bust.traverse((node) => {
      if (node instanceof Mesh) node.material = clay
    })
    const bounds = new Box3().setFromObject(bust)
    const size = bounds.getSize(new Vector3())
    const scale = 3 / Math.max(size.x, size.y, size.z, 0.001)
    const offset = bounds.getCenter(new Vector3()).multiplyScalar(-scale)
    const height = size.y * scale
    const width = size.x * scale
    // 머리 가운데는 위쪽 1/3 지점, 어깨는 가슴 단면 바로 위 양 끝
    const head = new Vector3(0, height * 0.2, 0)
    const shoulder = new Vector3(width * 0.42, -height * 0.38, -0.05)
    const floor = -height / 2
    return { bust, scale, offset, head, shoulder, floor }
  }, [gltf.scene])

  useEffect(() => {
    camera.lookAt(head.x, head.y - 0.25, head.z + 0.9)
    invalidate()
  }, [camera, head, invalidate])

  const pathPoints = useMemo(() => {
    const points: [number, number, number][] = []
    for (let i = 0; i <= 40; i += 1) {
      const yaw = MathUtils.lerp(0.8, -0.8, i / 40)
      points.push([head.x - Math.sin(yaw) * REACH, head.y, head.z + Math.cos(yaw) * REACH])
    }
    return points
  }, [head])

  const live = useRef({ x: 0, y: 0, tilt: 0, side: holdSide(step) })
  const body = useRef<Group>(null)
  const phone = useRef<Group>(null)
  const arm = useRef<Mesh>(null)
  const hand = useRef<Mesh>(null)
  const temp = useMemo(
    () => ({ from: new Vector3(), to: new Vector3(), dir: new Vector3(), q: new Quaternion() }),
    [],
  )
  const up = useMemo(() => new Vector3(0, 1, 0), [])

  useEffect(() => invalidate(), [step, immediate, invalidate])

  useFrame((_, delta) => {
    const pose = CAPTURE_POSES[step]
    const target = { x: pose.x, y: pose.y, tilt: pose.tilt, side: holdSide(step) }
    const dt = Math.min(delta, 0.05)
    const now = live.current
    for (const key of ['x', 'y', 'tilt', 'side'] as const) {
      now[key] = immediate ? target[key] : MathUtils.damp(now[key], target[key], EASE, dt)
    }

    // 위·아래는 고개만(휴대폰은 정면에 둔다)
    if (body.current) body.current.rotation.x = now.tilt

    // 휴대폰: 1인칭 장면의 카메라와 같은 방향, 팔 길이만큼
    const { from, to, dir, q } = temp
    to.set(
      head.x - Math.sin(now.y) * Math.cos(now.x) * REACH,
      head.y - Math.sin(now.x) * REACH,
      head.z + Math.cos(now.y) * Math.cos(now.x) * REACH,
    )
    if (phone.current) {
      phone.current.position.copy(to)
      // 셀카: 화면이 얼굴을 본다
      phone.current.lookAt(head)
    }

    // 쭉 뻗은 팔: 어깨에서 손(휴대폰 아래쪽)까지 한 줄
    from.set(shoulder.x * now.side, shoulder.y, shoulder.z)
    const handAt = dir.copy(to).add(HAND_BELOW_PHONE)
    if (arm.current) {
      const length = from.distanceTo(handAt)
      arm.current.position.copy(from).lerp(handAt, 0.5)
      arm.current.scale.set(1, length, 1)
      q.setFromUnitVectors(up, handAt.clone().sub(from).normalize())
      arm.current.quaternion.copy(q)
    }
    if (hand.current) hand.current.position.copy(handAt)

    const settled =
      Math.abs(now.x - target.x) +
        Math.abs(now.y - target.y) +
        Math.abs(now.tilt - target.tilt) +
        Math.abs(now.side - target.side) <
      0.0005
    if (!settled) invalidate()
  })

  return (
    <group>
      {/* 휴대폰이 지나는 길(왼쪽 ↔ 오른쪽) */}
      <Line
        points={pathPoints}
        color="#8d8a96"
        lineWidth={1.2}
        dashed
        dashSize={0.09}
        gapSize={0.08}
        transparent
        opacity={0.55}
      />
      {/* 바닥에 옅은 그림자(마네킹이 무대에 놓인 느낌) */}
      <ContactShadows
        position={[0, floor, 0.4]}
        opacity={0.22}
        scale={7}
        blur={2.8}
        far={2.4}
        color="#3a3346"
      />
      <group ref={body} position={[head.x, head.y, head.z]}>
        <group position={[-head.x, -head.y, -head.z]}>
          <group scale={scale} position={offset}>
            <primitive object={bust} />
          </group>
        </group>
      </group>
      {/* 팔은 길이 1짜리 원기둥을 늘려 쓴다 */}
      <mesh ref={arm}>
        <cylinderGeometry args={[0.085, 0.1, 1, 20]} />
        <meshStandardMaterial color={CLAY} roughness={0.82} />
      </mesh>
      <mesh ref={hand}>
        <sphereGeometry args={[0.12, 20, 20]} />
        <meshStandardMaterial color={CLAY} roughness={0.82} />
      </mesh>
      <group ref={phone}>
        <RoundedBox args={[0.5, 0.98, 0.07]} radius={0.06} smoothness={4}>
          <meshStandardMaterial color="#1e1c23" roughness={0.38} metalness={0.35} />
        </RoundedBox>
        {/* 화면(얼굴 쪽 면)이 은은하게 빛난다 */}
        <mesh position={[0, 0, 0.037]}>
          <planeGeometry args={[0.43, 0.9]} />
          <meshStandardMaterial
            color="#f1eeff"
            emissive="#c9bdff"
            emissiveIntensity={0.55}
            roughness={0.4}
          />
        </mesh>
      </group>
    </group>
  )
}
