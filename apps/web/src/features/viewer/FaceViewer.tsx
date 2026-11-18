'use client'

/**
 * 3D 얼굴 뷰어 (S15P31B204-276). FN-EDIT-01 Before/After 비교, FN-REC-04 기본 모델 회전·확대.
 *
 * **서버에서 불러오면 안 되는 모듈이다.** three.js·React Three Fiber는 `window`·WebGL을 쓴다.
 * 반드시 `FaceViewerLoader`(`dynamic(..., { ssr: false })`)를 거쳐 들어온다.
 * React Three Fiber 9.8은 React `>=19 <19.4`만 지원한다(docs/specs/toolchain.md).
 *
 * 구조
 * - Canvas(WebGL 컨텍스트) 하나, 카메라 하나, OrbitControls 하나.
 * - 같은 GLB를 두 번 복제해 Before(원본 고정)·After(가중치 적용)를 둔다.
 * - 나란히 비교는 화면을 좌우로 나눠(scissor) 같은 카메라로 두 번 그린다. 그래서 두 뷰의 각도가 항상 같다
 *   (FN-EDIT-01 수용 1). 하나로 보기에서 Before/After를 바꿔도 카메라가 그대로라 시점이 유지된다(수용 3).
 * - 모바일 성능: `frameloop="demand"`(바뀔 때만 그린다), dpr 상한 1.75, 컨텍스트 하나.
 */

import { Html, OrbitControls, useGLTF } from '@react-three/drei'
import { readFaceProfile, type MeasureProfileTrial } from '@/features/edit/lab/faceProfile'
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Box3,
  Group,
  MathUtils,
  Mesh,
  MOUSE,
  Vector3,
  type BufferGeometry,
  type DirectionalLight,
  type Object3D,
  type PerspectiveCamera,
} from 'three'
import { PRIVATE_MEDIA } from '@/shared/analytics'
import { useTheme } from '@/shared/theme/theme'
import { Button } from '@/shared/ui'
import { readEyeReview } from '@/features/edit/eyes/review'
import type { EyeReview, EyeState } from '@/features/edit/eyes/state'
import { grayMaterials, prepareEyeRig, setEyeBaseOffset } from './eyeRig'
import { useEyeDeform } from './useEyeDeform'
import { useEyeLimits } from './useEyeLimits'
import {
  controlsForHandle,
  dragNoseHandle,
  nearestNoseHandle,
  noseHandleDirectionHints,
  noseHandleDragChanges,
} from './noseHandleDrag'
import { applyPointStrokes } from '../../../../../services/gpu-worker/reconstruction/engine/point-strokes.mjs'
import {
  auditNoseSkinGeometry,
  protectedNoseSkinVertices,
} from '../../../../../services/gpu-worker/reconstruction/engine/nose-skin-audit.mjs'
import {
  applyMorphWeights,
  CONTOUR_CODES,
  KNOWN_MORPH_CODES,
  POC_MORPH_KEYS,
  supportedCodes,
  type MorphTargetHolder,
} from './morphTargets'
import {
  applyNoseToSkin,
  evaluateNoseCanonical,
  highlightedNoseHandles,
  loadNoseRig,
  noseEditPasses,
  nosePointHandles,
  noseHandleWorldPosition,
  nosePositions,
  type NoseRig,
} from './noseRig'
import type {
  CompareLayout,
  CompareSide,
  FaceViewerProps,
  ViewerStatus,
  ViewRequest,
  ViewerLighting,
} from './types'
import { presetCameraPosition } from './viewPresets'
import { applyComparisonFrame, applyViewportFrame } from './viewportFraming'
import { comparisonFitDistance, comparisonSeparationDistance } from './comparisonFraming'
import { DEFAULT_LIGHTING, lightingPosition } from './lighting'
import { StageShadow, STUDIO_ENV_INTENSITY, StudioEnvironment } from './studioStage'
import { HairLayer } from './HairLayer'
import { holdHairFits } from './hairFitClient'
import { useHairPrefetch } from './useHairPrefetch'
import {
  cloneComparisonScenes,
  cloneMeshGeometry,
  disposeOwnedGeometries,
  type OwnedGeometries,
} from './viewerClones'
import { expressionBus, markAfterOnly } from '@/features/expression/bus'
import { ExpressionLayer } from '@/features/expression/ExpressionLayer'
import { gateWheelToModel, projectedBounds } from './wheelZoomArea'

/** 모델을 이 높이(장면 단위)에 맞춘다 */
const FIT_SIZE = 2.4
const CAMERA_DISTANCE = 6.2
/**
 * 가장 가까이 당길 수 있는 거리(대상 중심 기준). 모델 높이가 2.4라 1.5까지 당기면 코·눈 같은 부위가 화면을 크게
 * 채운다(-416). 이보다 가까우면 얼굴 안쪽으로 들어갈 수 있다
 */
const MIN_DISTANCE = 1.5
const MAX_DISTANCE = 11
const CAMERA_ELEVATION_DEG = 4
/**
 * 옮기기(이동) 한계: 바라보는 중심이 원점에서 각 축으로 이만큼(장면 단위)까지만 간다(2026-10-30).
 * 모델 높이가 2.4라 0.9면 머리 높이의 3분의 1쯤까지 옮길 수 있고, 화면 밖으로 사라지지 않는다.
 */
const PAN_LIMIT = 0.9
const TARGET: [number, number, number] = [0, 0, 0]
const MOUSE_BUTTONS = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }

export default function FaceViewer(props: FaceViewerProps) {
  const { meshUrl, rigUrl, onStatusChange } = props
  // 어두운 화면은 바탕이 검정이라 테두리 빛으로 얼굴 윤곽을 바탕에서 떼어 낸다(밝은 화면은 원래 조명 그대로)
  const dark = useTheme() === 'dark'
  const assetKey = `${meshUrl}|${rigUrl ?? ''}`
  const [loadedRig, setLoadedRig] = useState<{ url: string; rig: NoseRig } | null>(null)
  const [draggingPoint, setDraggingPoint] = useState(false)
  const [selection, setSelection] = useState<{ key: string; handle: string } | null>(null)
  const selectionKey = `${assetKey}|${props.view.preset}|${props.view.nonce}|${props.pointEditEnabled}`
  const selectedHandle = selection?.key === selectionKey ? selection.handle : null
  const selectHandle = (handle: string | null) =>
    setSelection(handle ? { key: selectionKey, handle } : null)
  const [state, setState] = useState<{
    url: string
    attempt: number
    status: ViewerStatus
    /** 실패 원인: GLB(모델) 또는 WebGL(캔버스) */
    failure: 'model' | 'webgl' | null
  }>({ url: assetKey, attempt: 0, status: 'loading', failure: null })

  // 주소가 바뀌면 처음부터 다시 불러온다(렌더 중 상태 맞추기)
  if (state.url !== assetKey) {
    setState({ url: assetKey, attempt: 0, status: 'loading', failure: null })
  }

  const status = state.url === assetKey ? state.status : 'loading'
  useEffect(() => onStatusChange?.(status), [status, onStatusChange])

  const fail = (failure: 'model' | 'webgl') =>
    setState((prev) => ({ ...prev, status: 'error', failure }))

  useEffect(() => {
    if (!rigUrl) return
    const controller = new AbortController()
    loadNoseRig(rigUrl, controller.signal)
      .then((rig) => setLoadedRig({ url: rigUrl, rig }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) fail('model')
      })
    return () => controller.abort()
  }, [rigUrl, state.attempt])

  function retry() {
    useGLTF.clear(meshUrl)
    setState((prev) => ({ ...prev, attempt: prev.attempt + 1, status: 'loading', failure: null }))
  }

  return (
    <div
      {...PRIVATE_MEDIA}
      className="relative size-full"
      data-viewer-status={status}
      aria-busy={status === 'loading'}
    >
      <Boundary
        resetKey={`${meshUrl}#${state.attempt}`}
        onError={() => fail('webgl')}
        fallback={null}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 1.75]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'default',
            preserveDrawingBuffer: props.capturable === true,
          }}
          camera={{
            fov: 30,
            near: 0.1,
            far: 100,
            position: presetCameraPosition(
              props.view.preset,
              CAMERA_DISTANCE,
              TARGET,
              CAMERA_ELEVATION_DEG,
            ),
          }}
          aria-label={
            props.rotationOnly
              ? '3D 얼굴 모델. 드래그해 회전한다'
              : props.enablePan
                ? '3D 얼굴 모델. 왼쪽 드래그로 회전, 오른쪽 드래그로 이동, 스크롤로 확대한다'
                : '3D 얼굴 모델. 드래그해 회전하고 스크롤해 확대한다'
          }
        >
          {/* 스튜디오 무대: 은은한 반사 환경 + 한 장 보기에서는 흉상 아래 접지 그림자(studioStage) */}
          <StudioEnvironment
            intensity={dark ? STUDIO_ENV_INTENSITY.dark : STUDIO_ENV_INTENSITY.light}
          />
          {(props.layout ?? 'single') === 'single' ? (
            <StageShadow y={-FIT_SIZE / 2 - 0.005} opacity={dark ? 0.32 : 0.2} />
          ) : null}
          {dark ? (
            <DarkStageLighting lighting={props.lighting ?? DEFAULT_LIGHTING} />
          ) : props.lighting ? (
            <StudioLighting lighting={props.lighting} />
          ) : (
            <>
              <hemisphereLight args={['#ffffff', '#d9d2c7', 1.1]} />
              <directionalLight position={[2.5, 3, 4]} intensity={1.8} />
              <directionalLight position={[-3, 1, 2]} intensity={0.5} />
            </>
          )}
          <OrbitControls
            makeDefault
            enabled={!draggingPoint}
            onStart={() => selectHandle(null)}
            onChange={(event) => clampPan(event?.target, props.panLimit ?? PAN_LIMIT)}
            enablePan={!props.rotationOnly && (props.enablePan ?? false)}
            enableZoom={!props.rotationOnly}
            screenSpacePanning
            mouseButtons={props.rotationOnly ? { LEFT: MOUSE.ROTATE } : MOUSE_BUTTONS}
            enableDamping
            minDistance={props.zoomRange?.min ?? MIN_DISTANCE}
            maxDistance={props.zoomRange?.max ?? MAX_DISTANCE}
            minPolarAngle={Math.PI * 0.2}
            maxPolarAngle={Math.PI * 0.8}
          />
          <CameraRig
            view={props.view}
            frame={
              props.layout === 'single' || props.comparisonOverflow
                ? props.viewportFrame
                : undefined
            }
          />
          <Boundary
            key={`${meshUrl}#${state.attempt}`}
            resetKey={`${meshUrl}#${state.attempt}`}
            onError={() => fail('model')}
            fallback={null}
          >
            <Suspense fallback={null}>
              {(!rigUrl || loadedRig?.url === rigUrl) && (
                <Model
                  {...props}
                  rig={rigUrl && loadedRig?.url === rigUrl ? loadedRig.rig : null}
                  onDragState={setDraggingPoint}
                  selectedHandle={selectedHandle}
                  onSelectHandle={selectHandle}
                  onReady={() =>
                    setState((prev) =>
                      prev.status === 'ready' ? prev : { ...prev, status: 'ready' },
                    )
                  }
                />
              )}
            </Suspense>
          </Boundary>
        </Canvas>
      </Boundary>

      {status === 'loading' ? (
        <div
          role="status"
          className="pf-viewer-loading pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {/* 글 대신 가운데 가는 선 하나(system.css .pf-loader). 문구는 화면 읽기 프로그램에만 */}
          <span className="pf-loader" aria-hidden="true" />
          <p className="sr-only">3D 모델을 불러오는 중이에요</p>
        </div>
      ) : null}
      {status === 'error' ? (
        <ErrorOverlay
          message={
            state.failure === 'webgl'
              ? '이 기기에서 3D를 표시하지 못했어요.'
              : '3D 모델을 불러오지 못했어요.'
          }
          onRetry={retry}
        />
      ) : null}
    </div>
  )
}

/**
 * 어두운 화면의 무대 조명(2026-10-31, 랜딩 App.jsx와 같은 짜임): 따뜻한 주광(사용자가 위치를 바꾼다)
 * + 뒤쪽 양옆의 차가운 테두리 빛 2개. 모든 빛이 카메라를 따라 돌아 어느 각도에서도 같은 인상이다.
 */
function DarkStageLighting({ lighting }: { lighting: ViewerLighting }) {
  const keyLight = useRef<DirectionalLight>(null)
  const fillLight = useRef<DirectionalLight>(null)
  const rimRight = useRef<DirectionalLight>(null)
  const rimLeft = useRef<DirectionalLight>(null)
  const invalidate = useThree((s) => s.invalidate)
  const position = useMemo(
    () => new Vector3(...lightingPosition(lighting.azimuth, lighting.elevation)),
    [lighting.azimuth, lighting.elevation],
  )
  const fill = useMemo(() => new Vector3(2, 1, 4), [])
  const rims = useMemo(() => [new Vector3(3.6, 2, -3), new Vector3(-3.6, 1.4, -2.6)], [])
  useEffect(
    () => invalidate(),
    [lighting.azimuth, lighting.elevation, lighting.intensity, invalidate],
  )
  useFrame(({ camera }) => {
    keyLight.current?.position.copy(position).applyQuaternion(camera.quaternion)
    fillLight.current?.position.copy(fill).applyQuaternion(camera.quaternion)
    rimRight.current?.position.copy(rims[0]).applyQuaternion(camera.quaternion)
    rimLeft.current?.position.copy(rims[1]).applyQuaternion(camera.quaternion)
  })
  return (
    <>
      <hemisphereLight args={['#ffffff', '#222226', 0.55]} />
      <directionalLight
        ref={keyLight}
        position={position}
        intensity={lighting.intensity}
        color="#fff3e6"
      />
      <directionalLight ref={fillLight} intensity={0.25} />
      <directionalLight ref={rimRight} intensity={2.2} color="#dfe6ff" />
      <directionalLight ref={rimLeft} intensity={1.3} color="#dfe6ff" />
    </>
  )
}

function StudioLighting({ lighting }: { lighting: ViewerLighting }) {
  const keyLight = useRef<DirectionalLight>(null)
  const fillLight = useRef<DirectionalLight>(null)
  const invalidate = useThree((s) => s.invalidate)
  const position = useMemo(
    () => new Vector3(...lightingPosition(lighting.azimuth, lighting.elevation)),
    [lighting.azimuth, lighting.elevation],
  )
  const fill = useMemo(() => new Vector3(2, 1, 4), [])
  useEffect(
    () => invalidate(),
    [lighting.azimuth, lighting.elevation, lighting.intensity, invalidate],
  )
  useFrame(({ camera }) => {
    keyLight.current?.position.copy(position).applyQuaternion(camera.quaternion)
    fillLight.current?.position.copy(fill).applyQuaternion(camera.quaternion)
  })
  return (
    <>
      <hemisphereLight args={['#ffffff', '#e4e1e8', 0.85]} />
      <directionalLight ref={keyLight} position={position} intensity={lighting.intensity} />
      <directionalLight ref={fillLight} intensity={0.3} />
    </>
  )
}

function ErrorOverlay({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-(--space-12) px-(--space-16) text-center"
    >
      <p className="type-kr-body-12-regular-lh15p6 text-text-ink">{message}</p>
      <Button
        variant="secondary"
        layout="inline"
        leadingIcon={null}
        trailingIcon={null}
        onClick={onRetry}
      >
        다시 불러오기
      </Button>
    </div>
  )
}

/** 시점 프리셋 요청을 카메라에 반영한다. 사용자가 확대한 거리는 유지한다 */
function CameraRig({
  view,
  frame,
}: {
  view: ViewRequest
  frame?: FaceViewerProps['viewportFrame']
}) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: Vector3; update: () => void } | null
  const invalidate = useThree((s) => s.invalidate)
  const size = useThree((s) => s.size)

  useLayoutEffect(() => {
    const cam = camera as PerspectiveCamera
    applyViewportFrame(cam, { width: size.width, height: size.height }, frame)
    invalidate()
  }, [camera, frame, size.width, size.height, invalidate])

  useEffect(() => {
    const target = new Vector3(...TARGET)
    const distance = camera.position.distanceTo(controls?.target ?? target) || CAMERA_DISTANCE
    camera.position.set(
      ...presetCameraPosition(view.preset, distance, TARGET, CAMERA_ELEVATION_DEG),
    )
    camera.lookAt(target)
    if (controls) {
      controls.target.copy(target)
      controls.update()
    }
    invalidate()
  }, [view.preset, view.nonce, camera, controls, invalidate])

  return null
}

function morphMeshes(root: Object3D): MorphTargetHolder[] {
  const meshes: MorphTargetHolder[] = []
  root.traverse((object) => {
    if (object instanceof Mesh && object.morphTargetInfluences) meshes.push(object)
  })
  return meshes
}

function Model({
  meshUrl,
  weights,
  layout,
  fitComparison,
  comparisonOverflow,
  viewportFrame,
  showing,
  onUnsupportedCodes,
  onSupportedCodes,
  onNosePreviewCheck,
  onEyeReview,
  onFaceProfile,
  pauseFaceProfile,
  rig,
  onReady,
  pointStrokes = [],
  pointEditEnabled,
  noseHandleControls = [],
  highlightCodes,
  onNoseHandlePreview,
  onNoseHandleCommit,
  onDragState,
  selectedHandle,
  onSelectHandle,
  eyeEdit,
  gray,
  hairUrl,
  onHairStatus,
  hairHidden,
  hairProbe,
  zoomOnlyOverModel,
  expressionRig,
}: FaceViewerProps & {
  rig: NoseRig | null
  onReady: () => void
  onDragState: (dragging: boolean) => void
  selectedHandle: string | null
  onSelectHandle: (handle: string | null) => void
}) {
  const gltf = useGLTF(meshUrl)
  const metadata = gltf.parser.json.asset.extras?.['live-mirror']
  const measureProfile = Boolean(onFaceProfile)
  const originalProfile = useMemo(
    () =>
      measureProfile &&
      metadata?.name === 'live-mirror-head' &&
      metadata.version === 1 &&
      typeof metadata.frame === 'string' &&
      metadata.frame.includes('+Y up') &&
      metadata.frame.includes('+Z forward')
        ? readFaceProfile(gltf.scene, metadata.landmark_vertex_ids, Boolean(metadata.detail))
        : null,
    [gltf.scene, metadata, measureProfile],
  )
  const assetEyeReview = useMemo(() => {
    const metadata = gltf.parser.json.asset.extras?.['live-mirror']
    return readEyeReview(metadata?.eye_review, metadata?.eye_parts_sha256)
  }, [gltf])
  useEffect(() => onEyeReview?.(assetEyeReview), [assetEyeReview, onEyeReview])
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const handleButtons = useRef(new Map<string, HTMLButtonElement>())
  const lastPointerDragged = useRef(false)
  const viewport = useThree((s) => s.size)
  const readThree = useThree((s) => s.get)
  const controlsInstance = useThree((s) => s.controls)
  const comparisonBounds = useRef<Vector3[]>([])
  const singleFraming = useRef<{ distance: number; target: Vector3 } | null>(null)
  const drag = useRef<{
    handle: string
    x: number
    y: number
    rightX: number
    rightZ: number
    controls: FaceViewerProps['noseHandleControls']
    changed: boolean
  } | null>(null)

  // 캐시된 원본 scene은 건드리지 않고 복제본 둘을 쓴다. Mesh 복제는 morphTargetInfluences를 따로 갖는다
  const eyeMode = Boolean(eyeEdit)
  // 눈 편집이 아니어도 회색으로만 보고 싶을 때(관리자 텍스처 전 메시) 같은 회색 재질을 쓴다
  const grayMode = eyeMode || gray === true
  const { root, before, after, afterMeshes, sources, skin, eyeRig, eyeError, materials, owned } =
    useMemo(() => {
      const box = new Box3().setFromObject(gltf.scene)
      const size = box.getSize(new Vector3())
      const center = box.getCenter(new Vector3())
      const scale = FIT_SIZE / Math.max(size.x, size.y, size.z, 1e-6)

      // 여기서 새로 만든 지오메트리(목 마개·피부 복제)는 owned에 모아 정리 때 해제한다(-802)
      const owned: OwnedGeometries = []
      // 목 아래 구멍을 피부 morph를 따르는 마개로 막는다(-713). morph 적용·회색 재질보다 먼저 붙인다
      const { before, after } = cloneComparisonScenes(gltf.scene, owned)
      const sources = new Map<Mesh, BufferGeometry>()
      after.traverse((object) => {
        if (object instanceof Mesh && object.name === 'skin') {
          sources.set(object, object.geometry)
        }
      })
      const skinMeshes: {
        template: ArrayLike<number>
        base: Float32Array
        target: Float32Array
        index: ArrayLike<number> | undefined
        protectedVertices: Set<number> | null
        mesh: Mesh
      }[] = []
      if (rig) {
        const modelMeta = gltf.parser.json.asset.extras?.['live-mirror']
        if (modelMeta?.fit_sha !== rig.fitSha || modelMeta?.template_vertices !== rig.map.length)
          throw Error('GLB/rig mismatch')
        after.traverse((object) => {
          if (!(object instanceof Mesh) || object.name !== 'skin') return
          cloneMeshGeometry(object, owned)
          markAfterOnly(object.geometry) // 표정 레이어가 같은 형상을 이어 쓴다(다시 복제하지 않게)
          const template =
            object.geometry.getAttribute('_TEMPLATE_INDEX') ??
            object.geometry.getAttribute('_template_index')
          const position = object.geometry.getAttribute('position')
          if (!template || !position || template.count !== position.count)
            throw Error('missing skin rig attribute')
          skinMeshes.push({
            template: template.array,
            base: Float32Array.from(position.array),
            target: position.array as Float32Array,
            index: object.geometry.index?.array,
            protectedVertices: protectedNoseSkinVertices(modelMeta),
            mesh: object,
          })
        })
        if (skinMeshes.length !== 1) throw Error('missing skin mesh')
      }
      // Before는 원본 고정(FN-EDIT-01 수용 2): 대응표의 효과를 0으로 맞춘 뒤 다시는 바꾸지 않는다
      applyMorphWeights(morphMeshes(before), {}, KNOWN_MORPH_CODES)

      const root = new Group()
      root.scale.setScalar(scale)
      root.position.copy(center.multiplyScalar(-scale))
      root.add(before, after)
      let eyeRig: ReturnType<typeof prepareEyeRig> | null = null
      let eyeError = ''
      if (eyeMode) {
        try {
          // 코 rig·morph는 세분화 원본 가중치로 옮겨 눈 변형과 함께 쓴다(eyeRig.setEyeBaseOffset).
          eyeRig = prepareEyeRig(
            after,
            gltf.parser.json.asset.extras?.['live-mirror']?.landmark_vertex_ids,
          )
        } catch (error) {
          eyeError = error instanceof Error ? error.message : '눈 편집 준비 실패'
        }
      }
      return {
        root,
        before,
        after,
        afterMeshes: morphMeshes(after),
        sources,
        skin: skinMeshes[0] ?? null,
        eyeRig,
        eyeError,
        materials: grayMode ? grayMaterials(root) : null,
        owned,
      }
    }, [gltf.scene, gltf.parser.json, rig, eyeMode, grayMode])
  // 휠 확대는 보이는 머리 사각형 안에서만(메인 체험, S15P31B204-770). 밖에서 굴리면 페이지가 넘어간다
  const wheelTarget = layout === 'single' ? (showing === 'before' ? before : after) : root
  useEffect(() => {
    if (!zoomOnlyOverModel) return
    const three = readThree()
    const area = (three.events.connected as HTMLElement | null | undefined) ?? three.gl.domElement
    return gateWheelToModel(area, () => {
      const { camera: current, gl } = readThree()
      return projectedBounds(wheelTarget, current, gl.domElement.getBoundingClientRect())
    })
  }, [zoomOnlyOverModel, wheelTarget, readThree])
  useEffect(
    () => () => {
      materials?.dispose()
      for (const skin of eyeRig?.skins ?? []) skin.mesh.geometry.dispose()
      // 원본 캐시는 그대로 두고 이 메모가 만든 목 마개·피부 복제 지오메트리만 해제한다
      disposeOwnedGeometries(owned)
    },
    [materials, eyeRig, owned],
  )
  const eyeState = eyeEdit?.state,
    eyeReview = eyeEdit?.review,
    eyeGray = eyeEdit ? eyeEdit.gray : gray ? true : undefined,
    eyeStatus = eyeEdit?.onStatus
  useLayoutEffect(() => {
    if (eyeGray === undefined) return
    materials?.apply(eyeGray)
    invalidate()
  }, [eyeGray, materials, invalidate])
  // 눈 변형은 값 하나에 수백 ms라 워커에서 계산하고 결과만 그린다(끄는 동안 화면이 멈추지 않게, -526)
  const [appliedEye, setAppliedEye] = useState<{
    rig: typeof eyeRig
    state: EyeState
    review: EyeReview
  } | null>(null)
  const requestEyeTrial = useEyeDeform(
    eyeRig,
    eyeState,
    eyeReview,
    eyeError,
    eyeStatus,
    invalidate,
    (rig, state, review) => {
      if (measureProfile) setAppliedEye({ rig, state, review })
    },
  )
  useEyeLimits(
    eyeRig,
    eyeReview,
    eyeEdit?.limitsKey,
    eyeState?.L.enabled || !eyeState?.R.enabled ? (eyeState?.L.style ?? 'inout') : eyeState.R.style,
    eyeEdit?.committed,
    { onLimits: eyeEdit?.onLimits, onChecking: eyeEdit?.onChecking, onCombo: eyeEdit?.onCombo },
    eyeEdit?.knownLimits,
  )

  useLayoutEffect(() => {
    if (!onNosePreviewCheck || !rig || !skin) return
    const { base, index, template, protectedVertices } = skin
    onNosePreviewCheck((candidate) => {
      // 서버 검사기(checkNoseEdit)와 같은 조건으로 판단한다. 느슨하면 서버가 거절해 값이 되돌아간다
      const nose = evaluateNoseCanonical(rig, candidate)
      if (nose.unsupported.length || !index) return false
      if (!nose.valid) return noseEditPasses(false, null, candidate, pointStrokes)
      const semantic = new Float32Array(base.length)
      applyNoseToSkin(rig, template, base, nose.positions, semantic)
      const edited = applyPointStrokes(semantic, template, rig.weights, pointStrokes)
      const audit = auditNoseSkinGeometry({ base, edited, template, index, protectedVertices })
      return noseEditPasses(nose.valid, audit, candidate, pointStrokes)
    })
    return () => onNosePreviewCheck(null)
  }, [onNosePreviewCheck, pointStrokes, rig, skin])

  const pointPreview = useMemo(() => {
    if (!rig || !skin) return null
    const nose = nosePositions(rig, weights)
    if (!nose) throw Error('invalid saved nose geometry')
    const semantic = new Float32Array(skin.base.length)
    applyNoseToSkin(rig, skin.template, skin.base, nose.positions, semantic)
    const positions = applyPointStrokes(semantic, skin.template, rig.weights, pointStrokes)
    const handles = nosePointHandles(rig, skin.template).map((handle) => ({
      id: handle.id,
      label: handle.label,
      vertex: handle.vertex,
      position: noseHandleWorldPosition(skin.mesh, positions, handle.skinIndex),
    }))
    return { positions, handles, unsupported: nose.unsupported }
  }, [rig, skin, weights, pointStrokes])
  const highlightedHandles =
    pointPreview && highlightCodes
      ? highlightedNoseHandles(pointPreview.handles, highlightCodes)
      : []

  useEffect(() => {
    // 코는 리그 한계로, 윤곽은 GLB에 구운 morph target이 있는지로 지원 여부를 정한다
    const codes = rig
      ? [
          ...KNOWN_MORPH_CODES.filter((code) => {
            const bounds = POC_MORPH_KEYS[code] ? rig.limits[POC_MORPH_KEYS[code]] : undefined
            return bounds && (bounds[0] < 0 || bounds[1] > 0)
          }),
          ...supportedCodes(afterMeshes, CONTOUR_CODES),
        ]
      : supportedCodes(afterMeshes, KNOWN_MORPH_CODES)
    onSupportedCodes?.([...codes])
  }, [rig, afterMeshes, onSupportedCodes])

  // 직전에 적용한 코드. weights에서 빠지면 0으로 되돌린다
  const appliedCodes = useRef<string[]>([])
  useLayoutEffect(() => {
    const codes = [...KNOWN_MORPH_CODES, ...appliedCodes.current]
    const morphWeights = rig
      ? Object.fromEntries(Object.entries(weights).filter(([code]) => !code.startsWith('nose.')))
      : weights
    const missing = applyMorphWeights(
      afterMeshes,
      morphWeights,
      rig ? codes.filter((code) => !code.startsWith('nose.')) : codes,
    )
    if (rig && skin && pointPreview) {
      if (eyeRig) {
        // 눈 세분화 피부에는 원본 정점 기준 코 변형 차이만 옮겨 더한다
        const delta = Float32Array.from(pointPreview.positions, (value, i) => value - skin.base[i])
        setEyeBaseOffset(eyeRig, skin.mesh, delta)
      } else {
        skin.target.set(pointPreview.positions)
        skin.mesh.geometry.getAttribute('position').needsUpdate = true
        skin.mesh.geometry.computeVertexNormals()
      }
      missing.push(...pointPreview.unsupported)
      // 표정 따라하기가 켜져 있으면 방금 쓴 위치 위에 지금 표정을 바로 다시 얹는다(그리기 전)
      expressionBus.rebase(pointPreview.positions)
    }
    appliedCodes.current = Object.keys(weights)
    onUnsupportedCodes?.(missing)
    invalidate()
  }, [afterMeshes, weights, rig, skin, pointPreview, eyeRig, onUnsupportedCodes, invalidate])

  useEffect(() => {
    if (!onFaceProfile || pauseFaceProfile) return
    if (
      eyeRig &&
      (appliedEye?.rig !== eyeRig ||
        appliedEye.state !== eyeState ||
        appliedEye.review !== eyeReview)
    )
      return
    const sample = (nose?: Float32Array, trialEyes?: readonly Float32Array[]) =>
      readFaceProfile(after, metadata.landmark_vertex_ids, Boolean(metadata.detail), (mesh) => {
        const source = sources.get(mesh)
        if (!source) return
        const eyeIndex = eyeRig?.skins.findIndex((item) => item.mesh === mesh) ?? -1
        const eyes = eyeRig?.skins[eyeIndex]
        const base = skin?.mesh === mesh ? (nose ?? pointPreview?.positions) : undefined
        return {
          source,
          base: trialEyes?.[eyeIndex] ?? eyes?.eye ?? base,
          offset:
            eyes && nose && skin?.mesh === mesh
              ? Float32Array.from(nose, (value, index) => value - skin.base[index])
              : eyes?.offset,
        }
      })
    const current = originalProfile && !eyeError ? sample() : null
    const measureTrial: MeasureProfileTrial = (changes) => {
      const trialWeights = Object.fromEntries(changes.map(({ code, value }) => [code, value]))
      if (changes.some(({ code }) => code.startsWith('nose.')) && rig) {
        if (!skin?.index) return null
        const candidateWeights = { ...weights, ...trialWeights }
        const candidate = nosePositions(rig, candidateWeights)
        if (!candidate || candidate.unsupported.length) return null
        const semantic = new Float32Array(skin.base.length)
        applyNoseToSkin(rig, skin.template, skin.base, candidate.positions, semantic)
        const edited = applyPointStrokes(semantic, skin.template, rig.weights, pointStrokes)
        const audit = auditNoseSkinGeometry({
          base: skin.base,
          edited,
          template: skin.template,
          index: skin.index,
          protectedVertices: skin.protectedVertices,
        })
        return noseEditPasses(true, audit, candidateWeights, pointStrokes) &&
          audit.affectedVertices > 0
          ? sample(edited)
          : null
      }
      const snapshots = afterMeshes.map((mesh) => [mesh, mesh.morphTargetInfluences] as const)
      try {
        for (const [mesh, influences] of snapshots) {
          if (influences) mesh.morphTargetInfluences = [...influences]
        }
        return applyMorphWeights(afterMeshes, trialWeights).length ? null : sample()
      } finally {
        for (const [mesh, influences] of snapshots) mesh.morphTargetInfluences = influences
      }
    }
    if (eyeRig && eyeReview) {
      measureTrial.eye = async (state) => {
        const result = await requestEyeTrial.current?.(state, eyeReview)
        if (!result?.changed || result.reductions.length) return null
        return sample(
          undefined,
          result.skins.map(({ eye }) => eye),
        )
      }
    }
    onFaceProfile(current, originalProfile, current ? measureTrial : undefined)
  }, [
    after,
    afterMeshes,
    rig,
    pointStrokes,
    sources,
    appliedEye,
    eyeRig,
    eyeState,
    eyeReview,
    eyeError,
    metadata,
    originalProfile,
    onFaceProfile,
    pauseFaceProfile,
    pointPreview,
    requestEyeTrial,
    skin,
    weights,
  ])

  const movePoint = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current
    if (!active) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    const changes = noseHandleDragChanges(
      active.handle,
      active.controls ?? [],
      dx,
      dy,
      active.rightX,
      active.rightZ,
    )
    active.changed ||= changes.some(
      (change) =>
        change.value !== active.controls?.find((control) => control.id === change.id)?.value,
    )
    if (active.changed) onNoseHandlePreview?.(changes)
  }

  const finishPoint = () => {
    const active = drag.current
    if (!active) return
    lastPointerDragged.current = active.changed
    drag.current = null
    onDragState(false)
    if (active.changed) onNoseHandleCommit?.()
  }

  const screenHandles = () =>
    Array.from(handleButtons.current, ([id, button]) => {
      const rect = button.getBoundingClientRect()
      return {
        id,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height,
      }
    })

  useEffect(() => {
    if (pointEditEnabled || !drag.current) return
    const changed = drag.current.changed
    drag.current = null
    onDragState(false)
    if (changed) onNoseHandleCommit?.()
  }, [pointEditEnabled, onDragState, onNoseHandleCommit])

  useEffect(() => {
    onReady()
    invalidate()
    // onReady는 매 렌더 새 함수라 모델이 바뀔 때만 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  useEffect(() => invalidate(), [layout, showing, invalidate])

  useLayoutEffect(() => {
    const orbit = readThree().controls as {
      target: Vector3
      minDistance: number
      maxDistance: number
      update: () => void
    } | null
    if (!fitComparison || !orbit || viewport.width < 2 || viewport.height <= 0) return
    const direction = camera.position.clone().sub(orbit.target).normalize()
    if (layout === 'side') {
      singleFraming.current ??= {
        distance: camera.position.distanceTo(orbit.target),
        target: orbit.target.clone(),
      }
      const bounds = new Box3().setFromObject(root)
      const center = bounds.getCenter(new Vector3())
      comparisonBounds.current = [bounds.min.x, bounds.max.x].flatMap((x) =>
        [bounds.min.y, bounds.max.y].flatMap((y) =>
          [bounds.min.z, bounds.max.z].map((z) => new Vector3(x, y, z)),
        ),
      )
      const inverseRotation = camera.quaternion.clone().invert()
      const corners = [bounds.min.x, bounds.max.x].flatMap((x) =>
        [bounds.min.y, bounds.max.y].flatMap((y) =>
          [bounds.min.z, bounds.max.z].map((z) => {
            const corner = new Vector3(x, y, z).sub(center).applyQuaternion(inverseRotation)
            return [corner.x, corner.y, corner.z] as const
          }),
        ),
      )
      const aspect =
        comparisonOverflow && viewportFrame
          ? (viewportFrame.width ?? viewport.width) / 2 / viewportFrame.height
          : Math.floor(viewport.width / 2) / viewport.height
      const fov = (camera as PerspectiveCamera).fov
      const minimum = comparisonOverflow
        ? Math.max(MIN_DISTANCE, comparisonSeparationDistance(corners, aspect, fov))
        : MIN_DISTANCE
      const distance = Math.max(comparisonFitDistance(corners, aspect, fov), minimum)
      orbit.minDistance = minimum
      orbit.maxDistance = Math.max(MAX_DISTANCE, distance * 2)
      orbit.target.copy(center)
      camera.position.copy(center).addScaledVector(direction, distance)
    } else if (singleFraming.current) {
      orbit.minDistance = MIN_DISTANCE
      orbit.maxDistance = MAX_DISTANCE
      orbit.target.copy(singleFraming.current.target)
      camera.position.copy(orbit.target).addScaledVector(direction, singleFraming.current.distance)
      singleFraming.current = null
    }
    orbit.update()
    invalidate()
  }, [
    fitComparison,
    layout,
    readThree,
    controlsInstance,
    camera,
    root,
    viewport.width,
    viewport.height,
    comparisonOverflow,
    viewportFrame,
    invalidate,
  ])

  // Html이 투영하기 전에 현재 비교 방식의 카메라 비율을 적용한다.
  useFrame(({ camera, size }) => {
    const cam = camera as PerspectiveCamera
    const aspect =
      (layout === 'side' && !comparisonOverflow ? Math.floor(size.width / 2) : size.width) /
      size.height
    if (layout === 'side' && comparisonOverflow && viewportFrame) {
      const orbit = readThree().controls as {
        target: Vector3
        minDistance: number
        update: () => void
      } | null
      if (orbit && comparisonBounds.current.length) {
        const inverse = cam.quaternion.clone().invert()
        const corners = comparisonBounds.current.map((point) => {
          const p = point.clone().sub(orbit.target).applyQuaternion(inverse)
          return [p.x, p.y, p.z] as const
        })
        const slotAspect = (viewportFrame.width ?? size.width) / 2 / viewportFrame.height
        const minimum = Math.max(
          MIN_DISTANCE,
          comparisonSeparationDistance(corners, slotAspect, cam.fov),
        )
        orbit.minDistance = minimum
        const distance = cam.position.distanceTo(orbit.target)
        if (distance < minimum) {
          cam.position.sub(orbit.target).setLength(minimum).add(orbit.target)
          orbit.update()
        }
      }
    }
    if (cam.aspect !== aspect) {
      cam.aspect = aspect
      cam.updateProjectionMatrix()
    }
  }, -1)

  // 맞춰 남겨 둔 헤어는 머리별로 지금·바로 전 머리까지 남는다. 뷰어가 모두 닫히면 잠시 뒤 버린다(hairFitClient, -861)
  useEffect(() => holdHairFits(), [])
  // 헤어를 고를 수 있는 화면(편집·체험)은 머리가 뜬 뒤 한가할 때 헤어를 미리 받아 맞춰 둔다(-861)
  const hairlineMeta = gltf.parser.json.asset.extras?.['live-mirror']?.hairline
  useHairPrefetch(gltf.scene, hairlineMeta, Boolean(onHairStatus))
  const hairTargets = useMemo(() => [before, after] as const, [before, after])
  const probeTargets = useMemo(() => [] as const, [])
  const activeHairUrl = hairUrl ?? hairProbe?.url
  const hairReady = useCallback(() => onHairStatus?.('ready'), [onHairStatus])
  const probeStatus = hairProbe?.onStatus
  const hairProbeReady = useCallback(() => probeStatus?.('ready'), [probeStatus])
  // 기본 렌더를 대신한다(priority 1)
  useFrame((frame) => {
    renderCompare(
      frame,
      { before, after },
      layout,
      showing,
      comparisonOverflow ? viewportFrame : undefined,
    )
  }, 1)

  return (
    <>
      <primitive object={root} />
      {/* 눈 편집이 열린 모델은 피부가 세분화본이라 눈 리그를 거쳐 얹는다. 눈 리그 준비에 실패했으면 얹지 않는다 */}
      {expressionRig && (!eyeMode || eyeRig) ? (
        <ExpressionLayer
          after={after}
          rig={expressionRig}
          skinBase={pointPreview?.positions ?? null}
          eyeRig={eyeRig}
          original={gltf.scene}
          active={layout === 'side' || showing === 'after'}
        />
      ) : null}
      {/* 원본 보기(누르고 있는 동안)·나란히 보기의 원본에도 같은 표정을 얹는다: 표정은 그대로고 편집값만 0이다 */}
      {expressionRig ? (
        <ExpressionLayer
          after={before}
          rig={expressionRig}
          skinBase={null}
          eyeRig={null}
          original={gltf.scene}
          active={layout === 'side' || showing === 'before'}
          edited={false}
        />
      ) : null}
      {activeHairUrl ? (
        // 헤어를 못 불러와도 얼굴은 그대로 보인다(헤어만 빠진다)
        <Boundary
          key={hairUrl ? activeHairUrl : `probe:${activeHairUrl}`}
          resetKey={activeHairUrl}
          onError={() => (hairUrl ? onHairStatus?.('error') : probeStatus?.('error'))}
          fallback={null}
        >
          <Suspense fallback={null}>
            <HairLayer
              url={activeHairUrl}
              head={gltf.scene}
              targets={hairUrl ? hairTargets : probeTargets}
              hairline={hairlineMeta}
              onReady={hairUrl ? hairReady : hairProbeReady}
              hidden={hairHidden}
            />
          </Suspense>
        </Boundary>
      ) : null}
      {layout === 'single' && showing === 'after' && !pointEditEnabled
        ? highlightedHandles?.map((handle) => (
            <Html key={handle.id} center position={handle.position}>
              <span
                role="img"
                aria-label={`${handle.label} 변경 부위`}
                className="pointer-events-none block size-(--space-12) rounded-full border border-bg-canvas bg-brand-violet/50 shadow-sm"
              />
            </Html>
          ))
        : null}
      {pointEditEnabled && rig && layout === 'single' && showing === 'after'
        ? pointPreview?.handles.map((handle) => {
            camera.updateMatrixWorld()
            const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
            if (!controlsForHandle(handle.id, noseHandleControls, right.x, right.z).length)
              return null
            const hints = noseHandleDirectionHints(handle.id, noseHandleControls, right.x, right.z)
            return (
              <Html key={handle.id} center position={handle.position}>
                <div className="relative size-(--space-16)">
                  {selectedHandle === handle.id ? (
                    <div
                      id={`nose-hints-${handle.id}`}
                      role="status"
                      className="pointer-events-none absolute inset-0"
                    >
                      {hints.map((hint) => (
                        <span
                          key={hint.key}
                          className={`type-kr-caption-10-medium-lh13 absolute z-10 whitespace-nowrap rounded-4 border border-line-default bg-bg-canvas/90 px-(--space-6) py-(--space-4) text-text-ink shadow-sm ${
                            hint.key === 'up'
                              ? 'bottom-full left-1/2 mb-(--space-4) -translate-x-1/2'
                              : hint.key === 'down'
                                ? 'top-full left-1/2 mt-(--space-4) -translate-x-1/2'
                                : hint.key === 'left'
                                  ? 'top-1/2 right-full mr-(--space-4) -translate-y-1/2'
                                  : 'top-1/2 left-full ml-(--space-4) -translate-y-1/2'
                          }`}
                        >
                          {hint.arrow} {hint.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    ref={(element) => {
                      if (element) handleButtons.current.set(handle.id, element)
                      else handleButtons.current.delete(handle.id)
                    }}
                    aria-label={`${handle.label} 구조 손잡이`}
                    aria-describedby={
                      selectedHandle === handle.id ? `nose-hints-${handle.id}` : undefined
                    }
                    className="group flex size-(--space-16) items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-brand-violet"
                    style={{ touchAction: 'none' }}
                    onFocus={() => {
                      if (!drag.current) onSelectHandle(handle.id)
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) onSelectHandle(handle.id)
                      else if (!lastPointerDragged.current) {
                        const nearest = nearestNoseHandle(
                          screenHandles(),
                          event.clientX,
                          event.clientY,
                        )
                        onSelectHandle(nearest)
                        if (nearest) handleButtons.current.get(nearest)?.focus()
                      }
                      lastPointerDragged.current = false
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      lastPointerDragged.current = false
                      const handles = screenHandles()
                      const nearest =
                        dragNoseHandle(handles, selectedHandle, event.clientX, event.clientY) ??
                        handle.id
                      onSelectHandle(nearest)
                      event.currentTarget.setPointerCapture(event.pointerId)
                      camera.updateMatrixWorld()
                      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
                      drag.current = {
                        handle: nearest,
                        x: event.clientX,
                        y: event.clientY,
                        rightX: right.x,
                        rightZ: right.z,
                        controls: noseHandleControls.map((control) => ({ ...control })),
                        changed: false,
                      }
                      handleButtons.current.get(nearest)?.focus()
                      onDragState(true)
                    }}
                    onPointerMove={movePoint}
                    onPointerUp={finishPoint}
                    onPointerCancel={finishPoint}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        onSelectHandle(null)
                        return
                      }
                      const direction = (
                        {
                          ArrowLeft: [-1.8, 0],
                          ArrowRight: [1.8, 0],
                          ArrowUp: [0, -1.8],
                          ArrowDown: [0, 1.8],
                        } as Record<string, [number, number]>
                      )[event.key]
                      if (!direction) return
                      event.preventDefault()
                      camera.updateMatrixWorld()
                      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
                      const changes = noseHandleDragChanges(
                        handle.id,
                        noseHandleControls,
                        ...direction,
                        right.x,
                        right.z,
                      ).filter(
                        (change) =>
                          change.value !==
                          noseHandleControls.find((control) => control.id === change.id)?.value,
                      )
                      if (changes.length > 0) {
                        onNoseHandlePreview?.(changes)
                        onNoseHandleCommit?.()
                      }
                    }}
                  >
                    <span className="pointer-events-none size-(--space-8) rounded-full border border-bg-canvas bg-brand-violet/70 shadow-sm group-hover:bg-brand-violet group-focus-visible:bg-brand-violet" />
                  </button>
                </div>
              </Html>
            )
          })
        : null}
    </>
  )
}

/** 나란히 비교는 같은 카메라로 좌우를 따로 그린다(scissor). 하나로 보기는 한쪽만 */
function renderCompare(
  { gl, scene, camera, size }: RootState,
  models: Record<CompareSide, Object3D>,
  layout: CompareLayout,
  showing: CompareSide,
  overflowFrame?: FaceViewerProps['viewportFrame'],
) {
  const cam = camera as PerspectiveCamera
  if (layout === 'side' && overflowFrame) {
    const autoClear = gl.autoClear
    gl.autoClear = false
    gl.setScissorTest(false)
    gl.setViewport(0, 0, size.width, size.height)
    gl.clear()
    for (const side of ['before', 'after'] as const) {
      models.before.visible = side === 'before'
      models.after.visible = side === 'after'
      applyComparisonFrame(cam, size, overflowFrame, side)
      gl.clearDepth()
      gl.render(scene, cam)
    }
    applyViewportFrame(cam, size, overflowFrame)
    gl.autoClear = autoClear
    return
  }
  const draw = (x: number, width: number, side: CompareSide) => {
    models.before.visible = side === 'before'
    models.after.visible = side === 'after'
    gl.setViewport(x, 0, width, size.height)
    gl.setScissor(x, 0, width, size.height)
    cam.aspect = width / size.height
    cam.updateProjectionMatrix()
    gl.render(scene, cam)
  }
  gl.setScissorTest(true)
  if (layout === 'side') {
    const half = Math.floor(size.width / 2)
    draw(0, half, 'before')
    draw(half, size.width - half, 'after')
  } else {
    draw(0, size.width, showing)
  }
  gl.setScissorTest(false)
}

/** GLB 실패·WebGL 실패를 잡는다. resetKey가 바뀌면 다시 시도한다 */
class Boundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey: string; onError: (error: unknown) => void },
  { failedKey: string | null }
> {
  state = { failedKey: null as string | null }

  static getDerivedStateFromError() {
    return { failedKey: '__pending__' }
  }

  componentDidCatch(error: unknown) {
    this.setState({ failedKey: this.props.resetKey })
    this.props.onError(error)
  }

  render() {
    const { failedKey } = this.state
    const failed = failedKey === '__pending__' || failedKey === this.props.resetKey
    return failed ? this.props.fallback : this.props.children
  }
}

/**
 * 옮긴 중심을 원점 둘레 상자(±limit) 안으로 되돌린다. 카메라도 같은 만큼 옮겨 보는 각도·거리는 그대로 둔다.
 * OrbitControls가 갱신을 마친 뒤(change) 부르므로 다시 update를 부르지 않는다.
 */
function clampPan(controls: unknown, limit: number) {
  const orbit = controls as { target?: Vector3; object?: { position: Vector3 } } | undefined
  if (!orbit?.target || !orbit.object) return
  const { target } = orbit
  const dx = MathUtils.clamp(target.x, -limit, limit) - target.x
  const dy = MathUtils.clamp(target.y, -limit, limit) - target.y
  const dz = MathUtils.clamp(target.z, -limit, limit) - target.z
  if (dx === 0 && dy === 0 && dz === 0) return
  target.x += dx
  target.y += dy
  target.z += dz
  orbit.object.position.x += dx
  orbit.object.position.y += dy
  orbit.object.position.z += dz
}
