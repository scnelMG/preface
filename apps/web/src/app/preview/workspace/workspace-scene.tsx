'use client'

import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, MathUtils, Mesh, Vector3, type Group } from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { applyMorphWeights, KNOWN_MORPH_CODES } from '@/features/viewer/morphTargets'
import { WORKSPACE_MODELS, type WorkspaceModel } from './workspace-data'

export function DraftScene({ model }: { model: WorkspaceModel }) {
  return (
    <Canvas
      frameloop="demand"
      dpr={1}
      camera={{ position: [0, 0.15, 5.8], fov: 30 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    >
      <hemisphereLight args={['#ffffff', '#dedbe4', 1.1]} />
      <directionalLight position={[-3, 4, 5]} intensity={1.8} />
      <Suspense fallback={null}>
        <OrbitHead item={model} index={0} turn={0} animate={false} />
      </Suspense>
    </Canvas>
  )
}

export default function WorkspaceScene({
  models = WORKSPACE_MODELS,
  turn,
  animate,
  onSelect,
  hideCenter = false,
}: {
  models?: readonly WorkspaceModel[]
  turn: number
  animate: boolean
  hideCenter?: boolean
  onSelect?: (index: number) => void
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.04, 6.4], fov: 32, near: 0.1, far: 40 }}
      gl={{ alpha: true, antialias: true }}
      style={{ touchAction: 'pan-y' }}
      aria-hidden="true"
    >
      <hemisphereLight args={['#ffffff', '#dedbe4', 1.1]} />
      <directionalLight position={[-3, 4, 5]} intensity={1.8} />
      <directionalLight position={[4, 1, 3]} intensity={0.5} />
      <directionalLight position={[1, 3, -4]} color="#eef1f9" intensity={0.6} />
      <Suspense fallback={null}>
        {models.map((item, index) => (
          <OrbitHead
            key={item.id}
            item={item}
            index={index}
            turn={turn}
            animate={animate}
            onSelect={onSelect}
            hideCenter={hideCenter}
            count={models.length}
          />
        ))}
      </Suspense>
    </Canvas>
  )
}

function OrbitHead({
  count = 1,
  item,
  index,
  turn,
  animate,
  onSelect,
  hideCenter = false,
}: {
  count?: number
  item: WorkspaceModel
  index: number
  turn: number
  animate: boolean
  hideCenter?: boolean
  onSelect?: (index: number) => void
}) {
  const gltf = useGLTF(item.sample.meshUrl)
  const group = useRef<Group>(null)
  const rotation = useRef(turn)
  const invalidate = useThree((s) => s.invalidate)
  const viewport = useThree((s) => s.viewport)
  const { object, scale, position } = useMemo(() => {
    const object = clone(gltf.scene)
    object.traverse((node) => {
      if (node instanceof Mesh && node.morphTargetInfluences)
        applyMorphWeights([node], item.weights, KNOWN_MORPH_CODES)
    })
    const bounds = new Box3().setFromObject(object)
    const size = bounds.getSize(new Vector3())
    const scale = 3 / Math.max(size.x, size.y, size.z, 0.001)
    return { object, scale, position: bounds.getCenter(new Vector3()).multiplyScalar(-scale) }
  }, [gltf.scene, item.weights])

  useEffect(() => invalidate(), [turn, animate, invalidate])
  useFrame((_, delta) => {
    if (!group.current) return
    const target = turn
    rotation.current = animate
      ? MathUtils.damp(rotation.current, target, 10, Math.min(delta, 0.05))
      : target
    const offset = ((index - rotation.current + count * 100 + count / 2) % count) - count / 2
    const distance = Math.abs(offset)
    const spacing = Math.min(3, viewport.width * 0.32)
    const fitScale = onSelect ? Math.min(1, viewport.width / 6) : 1
    group.current.visible = distance < 1.43 && (!hideCenter || distance > 0.55)
    group.current.position.set(offset * spacing, -0.04 + distance * 0.12, -distance * 1.8)
    // 옆 슬롯의 원근 때문에 얼굴 각도가 달라 보이지 않도록 카메라 방향을 보정한다.
    group.current.rotation.y =
      Math.atan2(-offset * spacing, 6.4 + distance * 1.8) + Math.sign(offset) * 0.65
    group.current.scale.setScalar((1 - Math.min(distance, 1.5) * 0.25) * fitScale)
    if (Math.abs(rotation.current - target) > 0.0001) invalidate()
  })

  return (
    <group
      ref={group}
      onClick={(event) => {
        event.stopPropagation()
        if (event.delta < 6) onSelect?.(index)
      }}
      onPointerOver={(event) => {
        if (onSelect) {
          event.stopPropagation()
          ;(event.nativeEvent.target as HTMLCanvasElement).style.cursor = 'pointer'
        }
      }}
      onPointerOut={(event) => {
        if (onSelect) (event.nativeEvent.target as HTMLCanvasElement).style.cursor = 'grab'
      }}
    >
      <group scale={scale} position={position}>
        <primitive object={object} />
      </group>
    </group>
  )
}
