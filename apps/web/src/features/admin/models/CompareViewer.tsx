'use client'

/**
 * 관리자 모델 비교 전용 3D 뷰어(S15P31B204-706). **서버에서 불러오면 안 된다.** `CompareViewerLoader`를 거친다.
 *
 * 앱의 `FaceViewer`는 편집(코·눈 rig, Before/After, 시점 프리셋 애니메이션)을 위한 것이라 카메라를 밖에서 정할 수 없다.
 * 여기서는 카메라를 촬영 사진의 카메라 그대로(위치·회전·화각·주점) 두어야 해서, 같은 로더(`useGLTF`)와 회색 재질
 * (`grayMaterials`)만 빌려 작은 뷰어를 따로 둔다. FaceViewer는 고치지 않는다.
 *
 * - 모델 정규화는 FaceViewer와 같다: 바운딩 박스 중심을 원점으로, 최대 변을 FIT_SIZE로(배율 k).
 *   GLB 좌표 카메라(`frame: 'glb'`)에도 같은 정규화를 건다: C' = (C − center)·k, 회전·화각 그대로.
 * - 사진 카메라 그대로일 때는 회전·확대를 끈다(겹쳐 보기와 어긋나지 않게).
 * - 그 밖에는 회전만 켜고, 같은 `link`를 받은 뷰어끼리 카메라를 맞춘다(텍스처·회색이 같은 각도).
 */

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  Component,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react'
import { Box3, Group, Matrix4, Vector3, type DirectionalLight, type PerspectiveCamera } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { grayMaterials } from '@/features/viewer/eyeRig'
import type { Vec3 } from './captureQuality'
import { fitPosition, FIT_SIZE, type CompareCamera } from './compareCamera'
import type { CameraLink } from './cameraLink'

export interface CompareViewerProps {
  meshUrl: string
  gray: boolean
  camera: CompareCamera
  /** 회전 허용(사진 카메라 그대로일 때는 부모가 끈다) */
  orbit: boolean
  /** 같은 link를 받은 뷰어끼리 회전을 맞춘다 */
  link?: CameraLink
  label: string
}

type Fit = { center: Vec3; scale: number }

export default function CompareViewer({
  meshUrl,
  gray,
  camera,
  orbit,
  link,
  label,
}: CompareViewerProps) {
  const [status, setStatus] = useState<{ url: string; value: 'loading' | 'ready' | 'error' }>({
    url: meshUrl,
    value: 'loading',
  })
  const [fit, setFit] = useState<Fit | null>(null)
  if (status.url !== meshUrl) setStatus({ url: meshUrl, value: 'loading' })

  return (
    <div className="relative size-full" data-viewer-status={status.value}>
      <Boundary key={meshUrl} onError={() => setStatus({ url: meshUrl, value: 'error' })}>
        <Canvas
          frameloop="demand"
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true }}
          camera={{ fov: camera.fovDeg, near: 0.01, far: 100, position: [0, 0, 6] }}
          aria-label={label}
        >
          <hemisphereLight args={['#ffffff', '#d9d2c7', 1.1]} />
          <HeadLight />
          <Suspense fallback={null}>
            <FittedModel
              url={meshUrl}
              gray={gray}
              onFit={setFit}
              onReady={() => setStatus({ url: meshUrl, value: 'ready' })}
            />
          </Suspense>
          {fit ? <CameraRig spec={camera} fit={fit} orbit={orbit} link={link} /> : null}
        </Canvas>
      </Boundary>
      {status.value === 'loading' ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <span className="pf-loader" aria-hidden="true" />
          <p className="sr-only">3D 모델을 불러오는 중이에요</p>
        </div>
      ) : null}
      {status.value === 'error' ? (
        <p
          role="alert"
          className="type-kr-body-12-regular-lh15p6 absolute inset-0 flex items-center justify-center p-(--space-16) text-center text-text-muted"
        >
          3D 모델을 불러오지 못했어요
        </p>
      ) : null}
    </div>
  )
}

/** 카메라 쪽에서 비추는 빛(FaceViewer StudioLighting과 같은 방식). 사진과 비교할 때 어느 방향이든 얼굴 앞면이 밝다 */
function HeadLight() {
  const light = useRef<DirectionalLight>(null)
  const offset = useMemo(() => new Vector3(1.5, 2, 4), [])
  useFrame(({ camera }) => {
    light.current?.position.copy(offset).applyQuaternion(camera.quaternion)
  })
  return <directionalLight ref={light} intensity={1.8} />
}

function FittedModel({
  url,
  gray,
  onFit,
  onReady,
}: {
  url: string
  gray: boolean
  onFit: (fit: Fit) => void
  onReady: () => void
}) {
  const gltf = useGLTF(url)
  const invalidate = useThree((s) => s.invalidate)
  const { root, fit, materials } = useMemo(() => {
    const box = new Box3().setFromObject(gltf.scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = FIT_SIZE / Math.max(size.x, size.y, size.z, 1e-6)
    const model = cloneSkinned(gltf.scene)
    const root = new Group()
    root.scale.setScalar(scale)
    root.position.copy(center.clone().multiplyScalar(-scale))
    root.add(model)
    return {
      root,
      fit: { center: center.toArray() as Vec3, scale },
      materials: gray ? grayMaterials(root) : null,
    }
  }, [gltf.scene, gray])

  useLayoutEffect(() => {
    materials?.apply(true)
    onFit(fit)
    onReady()
    invalidate()
    return () => materials?.dispose()
    // onFit·onReady는 부모가 매 렌더 새로 만든다. 모델이 바뀔 때만 알린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, fit, materials, invalidate])

  return <primitive object={root} />
}

const ORIGIN = new Vector3(0, 0, 0)

/** 비교 카메라를 three 카메라에 그대로 놓는다. `canvasAspect`는 사진 비율이 없을 때만 쓴다 */
function placeCamera(
  camera: PerspectiveCamera,
  spec: CompareCamera,
  fit: Fit,
  canvasAspect: number,
) {
  const position =
    spec.frame === 'glb' ? fitPosition(spec.position, fit.center, fit.scale) : spec.position
  camera.position.set(...position)
  const r = spec.rotation
  if (r) {
    camera.quaternion.setFromRotationMatrix(
      new Matrix4().makeBasis(
        new Vector3(r[0][0], r[1][0], r[2][0]),
        new Vector3(r[0][1], r[1][1], r[2][1]),
        new Vector3(r[0][2], r[1][2], r[2][2]),
      ),
    )
  } else {
    camera.up.set(0, 1, 0)
    camera.lookAt(ORIGIN)
  }
  camera.fov = spec.fovDeg
  camera.aspect = spec.aspect ?? canvasAspect
  const o = spec.viewOffset
  if (o) camera.setViewOffset(o.fullWidth, o.fullHeight, o.x, o.y, o.width, o.height)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
}

function CameraRig({
  spec,
  fit,
  orbit,
  link,
}: {
  spec: CompareCamera
  fit: Fit
  orbit: boolean
  link?: CameraLink
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const self = useMemo(() => Symbol('viewer'), [])

  // 카메라 놓기. 캔버스 크기가 바뀌면 three가 비율을 캔버스로 되돌리므로 다시 맞춘다
  useLayoutEffect(() => {
    placeCamera(camera, spec, fit, size.width / Math.max(size.height, 1))
    if (controls.current) {
      controls.current.target.copy(ORIGIN)
      controls.current.update()
    }
    invalidate()
  }, [camera, spec, fit, size.width, size.height, invalidate])

  // 다른 뷰어가 돌리면 같은 자리로
  useEffect(() => {
    if (!link || !orbit) return
    return link.subscribe(self, (position) => {
      camera.position.set(...position)
      camera.lookAt(ORIGIN)
      controls.current?.update()
      invalidate()
    })
  }, [link, orbit, self, camera, invalidate])

  if (!orbit) return null
  return (
    <OrbitControls
      ref={controls}
      target={[0, 0, 0]}
      enablePan={false}
      enableZoom={false}
      onChange={() => link?.publish(self, camera.position.toArray() as Vec3)}
    />
  )
}

class Boundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
