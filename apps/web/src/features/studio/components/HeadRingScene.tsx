'use client'

import { Suspense, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Color, MathUtils, Mesh, Vector3, type Group, type Material } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DEFAULT_LIGHTING, lightingPosition } from '@/features/viewer/lighting'
import { StageShadow, STUDIO_ENV_INTENSITY, StudioEnvironment } from '@/features/viewer/studioStage'
import { RING_CAMERA_Z, RING_FOV, slotOffset } from './ringMath'

/**
 * 작업실 머리 고리(2026-10-31, inkwell식). 3D 캔버스 하나에 모든 머리를 큰 원 위에 놓는다.
 * 고리를 돌리면 머리가 원을 따라 돌며 옆으로 비껴 서고(가운데 쪽을 보며 비스듬히), 멀어질수록 작아지고 뒤로 물러난다.
 * 옆 머리도 원래 피부색 그대로 두고(회색·석고 형상은 사용자에게 보이지 않는다, 2026-10-31 사용자 결정),
 * 빛만 조금 덜 받은 듯 어둡게 해 가운데 머리가 앞에 선 것처럼 보이게 한다(색은 그대로, 밝기만 72%까지).
 * 가운데 머리는 천천히 고개를 좌우로 돌린다(움직임 줄이기면 멈춤).
 *
 * 위치(`drive.pos`)는 DOM 쪽(HeadRing)이 드래그·가로 스크롤로 바꾸고, 여기서는 목표(`drive.target`)로 부드럽게 따라간다.
 * 조명은 편집실 FaceViewer 기본(반구광 + 주광 DEFAULT_LIGHTING + 약한 보조광)과 같다.
 */

export interface RingDrive {
  /** 지금 고리 위치(가상 칸 번호, 소수). 끝없이 커지거나 작아질 수 있다 */
  pos: number
  /** 멈출 칸 */
  target: number
  dragging: boolean
}

/** 가운데 머리 누르기 구역(캔버스 기준 px). 고개를 좌우로 돌릴 때의 최대 범위 */
export interface CenterZone {
  left: number
  right: number
  top: number
  bottom: number
}

export interface RingItem {
  /** 머리 id로 구분한다 */
  key: string
  url: string | null
}

/** 칸 사이 각도(rad) */
const STEP = 0.62
/** 이만큼 멀어지면 그리지 않는다(칸 단위) */
const HIDE_AT = 1.45
/** 가운데 머리 고개 돌리기 최대 각도(rad) */
const SWAY_MAX = 0.2

export default function HeadRingScene({
  items,
  drive,
  sway,
  onPick,
  onLoaded,
  onReady,
  centerZone,
}: {
  items: readonly RingItem[]
  drive: MutableRefObject<RingDrive>
  /** 가운데 머리가 천천히 고개를 돌린다 */
  sway: boolean
  /** 머리를 눌렀다(가상 칸 번호). 옆 머리는 돌리기, 가운데 머리는 편집하기(-605)를 HeadRing이 정한다 */
  onPick: (slot: number, clientX: number, clientY: number) => void
  /** 가운데 머리가 매 프레임 자기 누르기 구역을 적는다(HeadRing이 누른 위치와 비교) */
  centerZone: MutableRefObject<CenterZone | null>
  /** 칸의 메시를 다 불러왔다 */
  onLoaded: (slot: number) => void
  /** 다시 그리기 함수를 넘긴다(DOM 쪽 드래그가 부른다) */
  onReady: (invalidate: () => void) => void
}) {
  const key = lightingPosition(DEFAULT_LIGHTING.azimuth, DEFAULT_LIGHTING.elevation)
  const fill = lightingPosition(-DEFAULT_LIGHTING.azimuth, 10)
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.06, RING_CAMERA_Z], fov: RING_FOV, near: 0.1, far: 50 }}
      // 편집하기를 누른 순간의 가운데 머리를 그림으로 떠서 편집실로 날려 보낸다(shared/ui/HandoffLayer)
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#ffffff', '#e4e1e8', 0.85]} />
      <directionalLight position={key} intensity={DEFAULT_LIGHTING.intensity} />
      <directionalLight position={fill} intensity={0.3} />
      {/* 스튜디오 무대: 편집실 3D와 같은 반사 환경 + 머리들 아래 접지 그림자 */}
      <StudioEnvironment intensity={STUDIO_ENV_INTENSITY.light} />
      <RingShadow />
      <RingDriver
        drive={drive}
        sway={sway}
        count={items.length}
        onReady={onReady}
        centerZone={centerZone}
      />
      {items.map((item, slot) =>
        item.url ? (
          <Suspense key={item.key} fallback={null}>
            <RingHead
              url={item.url}
              slot={slot}
              count={items.length}
              drive={drive}
              sway={sway}
              onPick={onPick}
              onLoaded={onLoaded}
              centerZone={centerZone}
            />
          </Suspense>
        ) : null,
      )}
    </Canvas>
  )
}

/** 한 프레임에 한 번 위치를 목표로 당긴다. 움직이는 동안(또는 고개 돌리기 중)만 다시 그린다 */
function RingDriver({
  drive,
  sway,
  count,
  onReady,
  centerZone,
}: {
  drive: MutableRefObject<RingDrive>
  sway: boolean
  count: number
  onReady: (invalidate: () => void) => void
  centerZone: MutableRefObject<CenterZone | null>
}) {
  const invalidate = useThree((s) => s.invalidate)
  // 바깥에서 받은 ref를 이 컴포넌트의 ref에 담아 프레임마다 바꾼다(React 컴파일러: 받은 값은 직접 바꾸지 않는다)
  const driveRef = useRef(drive)
  const zoneRef = useRef(centerZone)
  useEffect(() => {
    onReady(invalidate)
    invalidate()
  }, [invalidate, onReady])
  useEffect(() => invalidate(), [count, sway, invalidate])
  useFrame((_, delta) => {
    // 누르기 구역은 이번 프레임의 가운데 머리가 다시 적는다. 가운데 머리가 없거나(받는 중·실패) 돌아가는 중이면
    // 비워 둔다 — 지난 머리의 비껴난 상자가 남아 옆 머리 누르기를 가로채지 않게(-799). 머리들보다 먼저 돈다
    zoneRef.current.current = null
    const d = driveRef.current.current
    if (!d.dragging) d.pos = MathUtils.damp(d.pos, d.target, 7.5, Math.min(delta, 0.05))
    if (d.dragging || Math.abs(d.pos - d.target) > 0.0005 || sway) invalidate()
    else d.pos = d.target
  })
  return null
}

/** 가운데 머리 밑면 높이에 고리 전체를 덮는 바닥 그림자(옆 머리는 조금 떠 있어 더 옅게 진다) */
function RingShadow() {
  const viewport = useThree((s) => s.viewport)
  const fit = Math.min(1, viewport.width / 5)
  return <StageShadow y={-0.05 - 1.5 * fit - 0.01} width={viewport.width * 1.2} depth={5} />
}

function RingHead({
  url,
  slot,
  count,
  drive,
  sway,
  onPick,
  onLoaded,
  centerZone,
}: {
  url: string
  slot: number
  count: number
  drive: MutableRefObject<RingDrive>
  sway: boolean
  onPick: (slot: number, clientX: number, clientY: number) => void
  onLoaded: (slot: number) => void
  centerZone: MutableRefObject<CenterZone | null>
}) {
  const gltf = useGLTF(url)
  const group = useRef<Group>(null)
  const driveRef = useRef(drive)
  const viewport = useThree((s) => s.viewport)
  const materialsRef = useRef<Material[]>([])
  const zoneRef = useRef(centerZone)
  const corner = useMemo(() => new Vector3(), [])

  // 머리마다 장면·재질을 복제한다(useGLTF 캐시 원본은 다른 화면도 쓰고, 칸마다 밝기를 따로 준다)
  const { object, scale, position, materials, half } = useMemo(() => {
    const object = clone(gltf.scene)
    const materials: Material[] = []
    object.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const list = (Array.isArray(node.material) ? node.material : [node.material]).map(
        (material: Material) => dimmable(material.clone()),
      )
      node.material = Array.isArray(node.material) ? list : list[0]
      materials.push(...list)
    })
    const bounds = new Box3().setFromObject(object)
    const size = bounds.getSize(new Vector3())
    const scale = 3 / Math.max(size.x, size.y, size.z, 0.001)
    return {
      object,
      scale,
      position: bounds.getCenter(new Vector3()).multiplyScalar(-scale),
      materials,
      /** 맞춘 크기(가로·세로·깊이 절반) */
      half: size.multiplyScalar(scale / 2),
    }
  }, [gltf.scene])

  useEffect(() => onLoaded(slot), [onLoaded, slot])
  useEffect(() => {
    materialsRef.current = materials
    return () => {
      for (const material of materials) material.dispose()
    }
  }, [materials])

  useFrame(({ clock, camera, size }) => {
    const head = group.current
    if (!head) return
    const offset = slotOffset(slot, driveRef.current.current.pos, count)
    const distance = Math.abs(offset)
    head.visible = distance < HIDE_AT
    if (!head.visible) return
    // 옆 머리가 화면 안쪽 3분의 1쯤에 오게 반지름을 화면 폭에 맞춘다
    // 좁은 화면(휴대폰)은 머리를 모두 줄이고, 옆 머리는 화면 가장자리에서 살짝 보이게 한다
    const fit = Math.min(1, viewport.width / 5)
    const radius = Math.min(3.1, viewport.width * (fit < 1 ? 0.4 : 0.34)) / Math.sin(STEP)
    const angle = offset * STEP
    const centered = Math.max(0, 1 - distance * 2)
    head.position.set(
      radius * Math.sin(angle),
      -0.05 + distance * 0.08,
      radius * (Math.cos(angle) - 1),
    )
    // 옆 머리는 가운데(보는 사람) 쪽으로 비스듬히 돌아 선다
    head.rotation.y =
      -angle * 0.9 + (sway ? Math.sin(clock.elapsedTime * 0.55) * 0.2 * centered : 0)
    head.scale.setScalar((1 - Math.min(distance, 1.5) * 0.2) * fit)
    applyDim(materialsRef.current, 1 - Math.min(distance, 1) * 0.28)
    if (distance < 0.5) writeCenterZone()

    /** 고개를 좌우 끝까지 돌렸을 때도 덮는 상자를 화면에 비춰 누르기 구역으로 적는다(-799) */
    function writeCenterZone() {
      if (!head) return
      const s = head.scale.x
      const halfX = (half.x + half.z * Math.sin(SWAY_MAX)) * s
      const zone = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
      for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
          corner
            .set(
              head.position.x + sx * halfX,
              head.position.y + sy * half.y * s,
              head.position.z + half.z * s,
            )
            .project(camera)
          const x = ((corner.x + 1) / 2) * size.width
          const y = ((1 - corner.y) / 2) * size.height
          zone.left = Math.min(zone.left, x)
          zone.right = Math.max(zone.right, x)
          zone.top = Math.min(zone.top, y)
          zone.bottom = Math.max(zone.bottom, y)
        }
      zoneRef.current.current = zone
    }
  })

  return (
    <group
      ref={group}
      onClick={(event) => {
        event.stopPropagation()
        // 끌다 놓은 것은 누르기가 아니다
        if (event.delta < 6) onPick(slot, event.nativeEvent.clientX, event.nativeEvent.clientY)
      }}
      onPointerOver={(event) => {
        // 옆 머리는 돌리기, 가운데 머리는 편집하기(-605). 둘 다 누를 수 있다
        event.stopPropagation()
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        document.body.style.cursor = ''
      }}
    >
      <group scale={scale} position={position}>
        <primitive object={object} />
      </group>
    </group>
  )
}

/** 재질의 원래 색을 기억해 둔다(밝기만 곱해 줄이고 색상·채도는 그대로) */
function dimmable(material: Material): Material {
  const color = (material as Material & { color?: Color }).color
  if (color) material.userData.baseColor = color.clone()
  return material
}

/** 칸마다 밝기(1 = 원래, 0.72 = 옆 머리) */
function applyDim(materials: readonly Material[], level: number) {
  for (const material of materials) {
    const base = material.userData.baseColor as Color | undefined
    const color = (material as Material & { color?: Color }).color
    if (base && color) color.copy(base).multiplyScalar(level)
  }
}
