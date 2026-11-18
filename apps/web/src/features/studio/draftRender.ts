import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Object3D,
} from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { applyMorphWeights, KNOWN_MORPH_CODES } from '@/features/viewer/morphTargets'
import { DEFAULT_LIGHTING, lightingPosition } from '@/features/viewer/lighting'
import { createStudioEnvironment, STUDIO_ENV_INTENSITY } from '@/features/viewer/studioStage'
import {
  applyNoseToSkin,
  loadNoseRig,
  nosePositions,
  type NoseRig,
} from '@/features/viewer/noseRig'
import {
  prepareEyeRig,
  setEyeBaseOffset,
  writeEyeResult,
  type EyeRig,
} from '@/features/viewer/eyeRig'
import { deformEyeSkins, type EyeDeformResult } from '@/features/viewer/eyeDeform'
import type { EyeDeformRequest, EyeDeformResponse } from '@/features/viewer/eyeDeform.worker'
import { readEyeReview } from '@/features/edit/eyes/review'
import { isDefaultEyes, type EyeReview, type EyeState } from '@/features/edit/eyes/state'
import type { MorphState } from '@/features/edit/types'
import { applyPointStrokes } from '../../../../../services/gpu-worker/reconstruction/engine/point-strokes.mjs'

/**
 * 시안 그림(2026-10-31). 시안 목록에는 시안별 그림이 없어서(HIS-06) 브라우저에서 직접 그린다.
 *
 * - 화면 밖 WebGL 하나로 원본(가중치 0)과 시안(가중치)을 같은 카메라·조명으로 차례로 그린다. 같은 구도라 겹쳐 비교할 수 있다.
 * - 조명·색 처리는 작업실·편집실 3D(R3F 기본: ACES 톤 매핑, sRGB, 반구광 + 주광 DEFAULT_LIGHTING + 보조광,
 *   스튜디오 반사 환경 studioStage)와 같다. 흉상이 칸을 채워 바닥 그림자는 두지 않는다.
 * - 결과는 이 탭 메모리의 blob 주소로만 둔다. 개인 얼굴 그림이라 저장·전송하지 않는다(새로고침하면 다시 그린다).
 * - 한 번에 하나씩 그린다(큐). 슬라이더 가중치에 더해 코 리그·점 조작·눈 편집도 편집 화면과 같은 함수로 적용한다(-813, DraftEdits).
 * - 메시 압축은 편집실(drei useGLTF)과 같은 방식으로 푼다(Draco 디코더 경로가 같다). 기본 모델은 압축이 없다.
 * - 끊김 줄이기: 시안 칸이 떠오르는 동안(약 0.8초)은 그리지 않고, 그 뒤에도 브라우저가 쉴 때만 한 장씩 그린다.
 *   셰이더는 머리마다 처음 한 번 비동기로 미리 만든다(compileAsync). 그림 인코딩(toBlob)은 브라우저가 따로 한다.
 */

const WIDTH = 480
const HEIGHT = 600
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'

interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  loader: GLTFLoader
}

let stage: Stage | null = null
/** 첫 그림은 시안 칸 등장 연출(pf-album-in)이 끝난 뒤에 */
const START_DELAY = 800
let queue: Promise<unknown> | null = null
const compiled = new Set<string>()
const meshes = new Map<string, Promise<GLTF>>()
const rigs = new Map<string, Promise<NoseRig>>()
const renders = new Map<string, Promise<string>>()

function getStage(): Stage {
  if (stage) return stage
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.setClearColor(0x000000, 0)

  const scene = new Scene()
  // 편집실·작업실 3D와 같은 스튜디오 반사 환경(studioStage)
  scene.environment = createStudioEnvironment(renderer)
  scene.environmentIntensity = STUDIO_ENV_INTENSITY.light
  scene.add(new HemisphereLight('#ffffff', '#e4e1e8', 0.85))
  const key = new DirectionalLight('#ffffff', DEFAULT_LIGHTING.intensity)
  key.position.set(...lightingPosition(DEFAULT_LIGHTING.azimuth, DEFAULT_LIGHTING.elevation))
  scene.add(key)
  const fill = new DirectionalLight('#ffffff', 0.3)
  fill.position.set(...lightingPosition(-DEFAULT_LIGHTING.azimuth, 10))
  scene.add(fill)

  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_PATH)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)

  stage = { renderer, scene, camera: new PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 100), loader }
  return stage
}

/** `key`로 한 번 받은 메시를 다시 쓴다(내 모델 주소는 10분짜리라 머리 id로 묶는다) */
function loadMesh(key: string, url: string): Promise<GLTF> {
  let found = meshes.get(key)
  if (!found) {
    found = getStage().loader.loadAsync(url)
    found.catch(() => meshes.delete(key))
    meshes.set(key, found)
  }
  return found
}

/** 코 리그도 머리 id로 한 번만 받는다(주소는 10분짜리) */
function loadRig(key: string, url: string): Promise<NoseRig> {
  let found = rigs.get(key)
  if (!found) {
    found = loadNoseRig(url)
    found.catch(() => rigs.delete(key))
    rigs.set(key, found)
  }
  return found
}

/**
 * 슬라이더 가중치 밖의 저장된 편집(-813). 편집 화면(FaceViewer)과 같은 함수로 적용한다.
 * - 코: 리그 주소가 있고 코 값이나 점 조작이 있으면 코 리그로 피부를 움직인다(리그를 쓰면 코 morph target은 쓰지 않는다)
 * - 점 조작(pointStrokes): 코 리그 위에 더한다. 리그가 없으면 편집 화면처럼 그리지 않는다
 * - 눈(쌍꺼풀·트임): 기본값이 아니고 GLB에 원본 쌍꺼풀 판정이 있으면 눈 리그로 피부를 바꾼다
 * 헤어는 서버에 저장하지 않아(편집 화면 안에서만 고른다) 그리지 않는다.
 */
export interface DraftEdits {
  rigUrl?: string | null
  pointStrokes?: MorphState['pointStrokes']
  eyeEdit?: EyeState | null
}

/**
 * 머리 하나를 정면으로 그려 blob 주소를 돌려준다. 같은 머리·같은 편집이면 한 번만 그린다.
 * @param headKey 머리 id(내 모델 faceModelId 등)
 */
export function renderHead(
  headKey: string,
  meshUrl: string,
  weights: Readonly<Record<string, number>>,
  edits: DraftEdits = {},
): Promise<string> {
  const strokes = edits.pointStrokes ?? []
  const eyes = edits.eyeEdit && !isDefaultEyes(edits.eyeEdit) ? edits.eyeEdit : null
  const useRig =
    !!edits.rigUrl &&
    (strokes.length > 0 ||
      Object.entries(weights).some(([code, value]) => code.startsWith('nose.') && value !== 0))
  const key = JSON.stringify([
    headKey,
    Object.entries(weights).sort(),
    useRig ? strokes : [],
    useRig,
    eyes,
  ])
  let found = renders.get(key)
  if (!found) {
    queue ??= wait(START_DELAY)
    const job = queue.then(idle).then(() =>
      draw(headKey, meshUrl, weights, {
        rigUrl: useRig ? edits.rigUrl : null,
        pointStrokes: strokes,
        eyeEdit: eyes,
      }),
    )
    queue = job.catch(() => undefined)
    found = job
    found.catch(() => renders.delete(key))
    renders.set(key, found)
  }
  return found
}

async function draw(
  headKey: string,
  meshUrl: string,
  weights: Readonly<Record<string, number>>,
  edits: DraftEdits,
): Promise<string> {
  const { renderer, scene, camera } = getStage()
  const [gltf, rig] = await Promise.all([
    loadMesh(headKey, meshUrl),
    edits.rigUrl ? loadRig(headKey, edits.rigUrl) : null,
  ])
  // 받은 원본은 그대로 두고 복제본에 편집을 적용한다. 복제본은 지오메트리를 같이 쓰므로 바꾸는 피부만 따로 복제한다
  const head = cloneSkinned(gltf.scene)
  const owned: BufferGeometry[] = []
  const meta = gltf.parser.json.asset?.extras?.['live-mirror'] as LiveMirrorMeta | undefined
  try {
    // 구도는 받은 원본 모양으로 정한다(편집과 상관없이 원본·시안이 같은 자리에 오게).
    // 눈 리그가 새로 만든 피부는 경계 상자에 morph target 끝까지 넣어 크게 잡히므로, 바꾸기 전 원본으로 잰다
    const bounds = new Box3().setFromObject(gltf.scene)
    const skin = rig ? noseSkin(head, meta, rig, owned) : null
    const eyes = edits.eyeEdit ? prepareEyes(head, meta, edits.eyeEdit) : null
    if (eyes) owned.push(...eyes.rig.skins.map((item) => item.mesh.geometry))
    const holders: Mesh[] = []
    head.traverse((node) => {
      if (node instanceof Mesh && node.morphTargetInfluences) holders.push(node)
    })
    holders.forEach((mesh) => mesh.morphTargetInfluences?.fill(0))
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const fitHeight = size.y * 1.08
    const fitWidth = (size.x * 1.2) / camera.aspect
    const distance = Math.max(fitHeight, fitWidth) / 2 / Math.tan((camera.fov * Math.PI) / 360)
    // 머리를 조금 위로(아래 글자 자리를 남긴다)
    camera.position.set(center.x, center.y - size.y * 0.06, center.z + distance)
    camera.lookAt(center.x, center.y - size.y * 0.06, center.z)

    // 코 리그를 쓰면 코 값은 morph target이 아니라 리그로 그린다(편집 화면과 같다)
    applyMorphWeights(
      holders,
      rig ? withoutNose(weights) : weights,
      rig ? KNOWN_MORPH_CODES.filter((code) => !code.startsWith('nose.')) : KNOWN_MORPH_CODES,
    )
    if (rig && skin) {
      const nose = nosePositions(rig, weights)
      if (!nose) throw Error('저장된 코 형상이 리그 검사를 통과하지 못했다')
      const semantic = new Float32Array(skin.base.length)
      applyNoseToSkin(rig, skin.template, skin.base, nose.positions, semantic)
      const positions = applyPointStrokes(
        semantic,
        skin.template,
        rig.weights,
        edits.pointStrokes ?? [],
      )
      if (eyes) {
        // 눈 세분화 피부에는 원본 정점 기준 코 변형 차이만 옮겨 더한다(편집 화면과 같다)
        setEyeBaseOffset(
          eyes.rig,
          skin.mesh,
          Float32Array.from(positions, (value, i) => value - skin.base[i]),
        )
      } else {
        skin.target.set(positions)
        skin.mesh.geometry.getAttribute('position').needsUpdate = true
        skin.mesh.geometry.computeVertexNormals()
      }
    }
    if (eyes) writeEyeResult(eyes.rig, await deformEyes(eyes.rig, eyes.state, eyes.review))

    scene.add(head)
    if (!compiled.has(headKey)) {
      // 처음 그리는 머리는 셰이더를 먼저 비동기로 만든다(첫 render에서 화면이 멈추지 않게)
      await renderer.compileAsync(scene, camera)
      compiled.add(headKey)
      await idle()
    }
    renderer.render(scene, camera)
    scene.remove(head)
  } finally {
    for (const geometry of new Set(owned)) geometry.dispose()
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    renderer.domElement.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new Error('시안 그림을 만들지 못했다')
  return URL.createObjectURL(blob)
}

function withoutNose(weights: Readonly<Record<string, number>>) {
  return Object.fromEntries(Object.entries(weights).filter(([code]) => !code.startsWith('nose.')))
}

interface LiveMirrorMeta {
  fit_sha?: string
  template_vertices?: number
  landmark_vertex_ids?: number[]
  eye_review?: unknown
  eye_parts_sha256?: unknown
}

/** 코 리그가 움직일 피부. 편집 화면(FaceViewer)과 같은 검사로, GLB와 리그가 맞지 않으면 던진다 */
function noseSkin(
  head: Object3D,
  meta: LiveMirrorMeta | undefined,
  rig: NoseRig,
  owned: BufferGeometry[],
) {
  if (meta?.fit_sha !== rig.fitSha || meta?.template_vertices !== rig.map.length)
    throw Error('GLB/rig mismatch')
  const skins: {
    mesh: Mesh
    template: ArrayLike<number>
    base: Float32Array
    target: Float32Array
  }[] = []
  head.traverse((object) => {
    if (!(object instanceof Mesh) || object.name !== 'skin') return
    object.geometry = object.geometry.clone()
    owned.push(object.geometry)
    const template =
      object.geometry.getAttribute('_TEMPLATE_INDEX') ??
      object.geometry.getAttribute('_template_index')
    const position = object.geometry.getAttribute('position')
    if (!template || !position || template.count !== position.count)
      throw Error('missing skin rig attribute')
    skins.push({
      mesh: object,
      template: template.array,
      base: Float32Array.from(position.array),
      target: position.array as Float32Array,
    })
  })
  if (skins.length !== 1) throw Error('missing skin mesh')
  return skins[0]
}

/** 눈 리그(피부 세분화). 원본 쌍꺼풀 판정을 모르거나 기준점이 없는 모델이면 눈은 그리지 않는다(null) */
function prepareEyes(head: Object3D, meta: LiveMirrorMeta | undefined, state: EyeState) {
  // 편집 화면도 판정을 모르는 모델은 눈 편집을 열지 않는다(matchesEyeReview)
  const evidence = readEyeReview(meta?.eye_review, meta?.eye_parts_sha256)
  if (evidence.review.L === 'unknown' || evidence.review.R === 'unknown') return null
  try {
    return { rig: prepareEyeRig(head, meta?.landmark_vertex_ids), state, review: evidence.review }
  } catch {
    return null
  }
}

/**
 * 눈 변형 계산. 값 하나에 수백 ms라 편집 화면처럼 워커에서 계산한다(그동안 작업실 화면이 멈추지 않게).
 * 워커를 못 쓰면 화면 스레드에서 계산한다.
 */
function deformEyes(rig: EyeRig, state: EyeState, review: EyeReview): Promise<EyeDeformResult> {
  const local = () => deformEyeSkins(rig.eyes, rig.spheres, rig.skins, state, review)
  if (typeof Worker === 'undefined') return Promise.resolve(local())
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../viewer/eyeDeform.worker.ts', import.meta.url), {
      type: 'module',
    })
    const fallback = () => {
      worker.terminate()
      resolve(local())
    }
    worker.onmessage = (event: MessageEvent<EyeDeformResponse>) => {
      const message = event.data
      if (message.type !== 'result') return fallback()
      worker.terminate()
      resolve(message)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fallback()
    }
    worker.postMessage({
      type: 'rig',
      landmarks: rig.landmarks,
      balls: rig.balls,
      skins: rig.skins.map((skin) => ({
        base: skin.base.slice(),
        normals: skin.normals.slice(),
        indices: skin.indices.slice(),
        lid: skin.lid,
      })),
    } satisfies EyeDeformRequest)
    worker.postMessage({ type: 'apply', id: 1, state, review } satisfies EyeDeformRequest)
  })
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

/** 브라우저가 쉴 때(없으면 잠깐 뒤). 너무 오래 미루지는 않는다 */
function idle() {
  return new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(() => resolve(), { timeout: 600 })
    else window.setTimeout(resolve, 40)
  })
}
