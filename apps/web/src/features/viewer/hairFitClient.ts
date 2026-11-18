import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  Sphere,
  Vector3,
} from 'three'
import { hairAssetOfUrl } from '@/features/edit/hair/catalog'
import {
  earAnchors,
  expectedScale,
  fitHairToHead,
  fitHairToLandmarks,
  type HairFit,
  hairlineAnchors,
  hairlineCurve,
  readHairline,
  readTemplateSkin,
  type SkinSurface,
  type TemplateSkin,
} from '@/features/edit/hair/hairFit'
import { ASSET_BASE_URL } from '@/shared/config/env'
import {
  createHairFitHandler,
  type HairFitRequest,
  type HairFitResponse,
  type HairHeadInput,
} from './hairFitCore'

/**
 * 헤어 맞춤의 화면 쪽(S15P31B204-861): 머리별 맞춤 입력, Worker에 맡기는 차례, 맞춘 사본을 남겨 두는 곳.
 *
 * - 맞춤 계산(hairFitCore.ts)은 Worker(hairFit.worker.ts)에서 돈다. 위치 배열은 옮겨(transfer) 보내고 받는다.
 *   Worker를 못 쓰는 환경(테스트 등)에서는 같은 처리 함수를 화면 스레드에서 부른다.
 * - 한 번에 하나만 Worker에 보낸다. 사용자가 고른 헤어(`urgent`)는 미리 맞추기(useHairPrefetch)보다 앞에 선다.
 *   같은 머리·헤어를 맞추는 중이면 그 결과를 같이 기다린다.
 * - 머리 정보(점 맞춤·피부·두피 변위 입력)는 머리마다 한 번 만들고, Worker도 머리마다 두피 변위 칸을 한 번만 만든다.
 * - 맞춘 사본은 머리별로 남긴다(-808은 머리 하나만 남겨 체험에서 기본 모델을 바꾸면 다 버렸다). 지금 머리와 바로 전 머리까지,
 *   위치 배열 합이 한계(`fitBudget`)를 넘으면 전 머리의 큰 것(레이어드컷)부터 버린다.
 */

// ---- 템플릿 피부 ----

let templateSkinLoad: Promise<TemplateSkin | null> | null = null

/** 템플릿 피부(public/hair/gnm-skin.bin)를 한 번만 받아 나눠 쓴다. 실패하면 null */
export function loadTemplateSkin(): Promise<TemplateSkin | null> {
  templateSkinLoad ??= fetch(`${ASSET_BASE_URL}/hair/gnm-skin.bin`)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .then((buffer) => (buffer ? readTemplateSkin(buffer) : null))
    .catch(() => null)
  return templateSkinLoad
}

// ---- 머리 정보 ----

type PointOf = (vertex: number) => [number, number, number] | null

/** 머리 하나에서 헤어와 상관없이 구하는 값 */
export interface HairHeadInfo {
  skin: Mesh | null
  pointOf: PointOf
  fit: HairFit
  /** 사람 헤어라인(머리 좌표). 없으면 빈 배열 */
  curve: readonly (readonly [number, number, number])[]
  hairline: unknown
  toHead: Matrix4
  fromHead: Matrix4
  inputs: Map<TemplateSkin | null, HairHeadInput>
}

const headInfos = new WeakMap<Object3D, HairHeadInfo>()

/** 머리의 점 맞춤·헤어라인. 머리(와 헤어라인)마다 한 번 구한다 */
export function hairHeadOf(head: Object3D, hairline: unknown): HairHeadInfo {
  const known = headInfos.get(head)
  if (known && known.hairline === hairline) return known
  let skin: Mesh | null = null
  head.traverse((object) => {
    if (!skin && object instanceof Mesh && object.name === 'skin') skin = object
  })
  head.updateMatrixWorld(true)
  const pointOf: PointOf = skin ? templatePoints(skin) : () => null
  const landmarkFit = skin ? fitHairToLandmarks(pointOf) : null
  const box = new Box3().setFromObject(skin ?? head, true)
  const fit =
    landmarkFit ??
    fitHairToHead(
      { min: box.min.toArray(), max: box.max.toArray() },
      undefined,
      expectedScale(pointOf),
    )
  // 사람 헤어라인이 있으면 헤어 앞부분을 그 선까지 옮긴다(S15P31B204-723)
  const points = readHairline(hairline)
  const curve = points ? hairlineCurve(points, pointOf) : []
  const toHead = headMatrix(fit)
  const info: HairHeadInfo = {
    skin,
    pointOf,
    fit,
    curve,
    hairline,
    toHead,
    fromHead: toHead.clone().invert(),
    inputs: new Map(),
  }
  headInfos.set(head, info)
  return info
}

/** Worker에 보내는 머리 입력(피부·귀·템플릿 점 대응). 템플릿 피부마다 한 번 만든다 */
function headInputOf(info: HairHeadInfo, templateSkin: TemplateSkin | null): HairHeadInput {
  const known = info.inputs.get(templateSkin)
  if (known) return known
  const { skin, pointOf, fit } = info
  let personByTemplate: Float64Array | null = null
  if (skin && templateSkin) {
    let top = 0
    for (const id of templateSkin.ids) top = Math.max(top, id)
    personByTemplate = new Float64Array((top + 1) * 3).fill(Number.NaN)
    for (const id of templateSkin.ids) {
      const q = pointOf(id)
      if (q) personByTemplate.set(q, id * 3)
    }
  }
  const input: HairHeadInput = {
    fit,
    ears: skin ? earAnchors(fit, pointOf) : [],
    surface: skin ? skinSurface(skin) : null,
    templateSkin,
    personByTemplate,
    toHead: Array.from(info.toHead.elements),
    fromHead: Array.from(info.fromHead.elements),
    earTris: skin && templateSkin ? earTriangles(skin, templateSkin) : null,
  }
  info.inputs.set(templateSkin, input)
  return input
}

/** 맞춘 사본을 찾는 이름(헤어 주소, 템플릿 피부 유무) */
export function hairFitKey(url: string, templateSkin: TemplateSkin | null): string {
  return `${url}|${templateSkin ? 'skin' : 'none'}`
}

// ---- 맞춘 사본 ----

/** 한 머리에 맞춘 헤어 사본과 그 재질 */
export interface HairFitEntry {
  scene: Object3D
  /** 맞추며 새로 만든 지오메트리(버릴 때 dispose). 맞추지 않고 원본을 쓰면 비어 있다 */
  geometries: BufferGeometry[]
  /** 원본 재질 → 바꾼 재질 */
  materials: Map<Material, Material>
  /** 새로 담은 위치 배열 크기(바이트) */
  bytes: number
}

/** 머리 하나에 남겨 두는 맞춘 헤어 수(헤어 목록 크기) */
const HAIR_FIT_KEEP = 3
/** 맞춘 헤어를 남겨 두는 머리 수(지금 머리와 바로 전 머리) */
const HAIR_FIT_HEADS = 2
/**
 * 남겨 둔 위치 배열 합의 한계(바이트). 머리 하나에 셋을 다 맞추면 86MB(레이어드컷 66MB, 댄디컷 17MB, 리프컷 3MB)다.
 * 메모리가 넉넉한 기기(`navigator.deviceMemory` 8GB 이상)는 두 머리를 다 남기고, 아니면 전 머리의 큰 것부터 버린다
 * (지금 머리 셋에 전 머리 리프컷 정도)
 */
function fitBudget(): number {
  const memory =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { deviceMemory?: number }).deviceMemory
  return (memory !== undefined && memory >= 8 ? 192 : 96) * 1024 * 1024
}

/** 머리 → (이름 → 사본). 둘 다 넣은 순서가 최근에 쓴 순서다(맨 뒤가 지금 머리) */
const fitHeads = new Map<Object3D, Map<string, HairFitEntry>>()

function disposeFit(entry: HairFitEntry) {
  for (const geometry of entry.geometries) geometry.dispose()
  for (const material of entry.materials.values()) material.dispose()
}

/** 머리를 지금 머리로 올린다 */
function touchHead(head: Object3D): Map<string, HairFitEntry> {
  const entries = fitHeads.get(head) ?? new Map<string, HairFitEntry>()
  fitHeads.delete(head)
  fitHeads.set(head, entries)
  return entries
}

/** 이 머리에 맞춘 사본이 있으면 돌려준다(최근에 쓴 것으로 올린다) */
export function takeFit(head: Object3D, key: string): HairFitEntry | undefined {
  if (!fitHeads.has(head)) return undefined
  const entries = touchHead(head)
  const entry = entries.get(key)
  if (entry) {
    entries.delete(key)
    entries.set(key, entry)
  }
  return entry
}

function keepFit(head: Object3D, key: string, entry: HairFitEntry): HairFitEntry {
  const entries = touchHead(head)
  const old = entries.get(key)
  if (old && old !== entry) disposeFit(old)
  entries.delete(key)
  entries.set(key, entry)
  trimFits()
  return entry
}

function trimFits() {
  for (const [head, entries] of fitHeads) {
    if (fitHeads.size <= HAIR_FIT_HEADS) break
    for (const entry of entries.values()) disposeFit(entry)
    fitHeads.delete(head)
  }
  let total = 0
  for (const entries of fitHeads.values()) {
    for (const [key, entry] of entries) {
      if (entries.size <= HAIR_FIT_KEEP) break
      entries.delete(key)
      disposeFit(entry)
    }
    for (const entry of entries.values()) total += entry.bytes
  }
  const current = [...fitHeads.values()].at(-1)
  const budget = fitBudget()
  while (total > budget) {
    // 전 머리의 가장 큰 사본부터, 없으면 지금 머리의 오래된 것부터(가장 최근 하나는 남긴다)
    let from: Map<string, HairFitEntry> | null = null
    let drop: string | null = null
    let size = -1
    for (const entries of fitHeads.values()) {
      if (entries === current) continue
      for (const [key, entry] of entries)
        if (entry.bytes > size) {
          size = entry.bytes
          from = entries
          drop = key
        }
    }
    if (!from && current && current.size > 1) {
      from = current
      drop = current.keys().next().value ?? null
    }
    if (!from || drop === null) break
    const entry = from.get(drop)!
    from.delete(drop)
    disposeFit(entry)
    total -= entry.bytes
  }
  for (const [head, entries] of fitHeads)
    if (!entries.size && entries !== current) fitHeads.delete(head)
}

let holders = 0
let releaseTimer: ReturnType<typeof setTimeout> | null = null
/** 뷰어가 다 닫히고 이만큼 지나면 남긴 헤어를 버린다. 체험에서 기본 모델을 바꾸면 뷰어가 새로 떠서 그 사이는 남긴다 */
const RELEASE_DELAY_MS = 10_000

/** 뷰어가 떠 있는 동안 남긴 헤어를 붙잡는다. 돌려준 함수로 놓는다(effect cleanup) */
export function holdHairFits(): () => void {
  holders++
  if (releaseTimer) clearTimeout(releaseTimer)
  releaseTimer = null
  return () => {
    holders--
    if (holders > 0) return
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (holders === 0) releaseHairFits()
    }, RELEASE_DELAY_MS)
  }
}

/** 남겨 둔 맞춘 헤어와 Worker를 모두 버린다 */
export function releaseHairFits() {
  for (const entries of fitHeads.values()) for (const entry of entries.values()) disposeFit(entry)
  fitHeads.clear()
  for (const job of queue.splice(0)) job.reject(new Error('헤어 맞춤을 그만뒀어요'))
  resetWorker()
}

// ---- Worker와 차례 ----

interface FitJob {
  head: Object3D
  key: string
  url: string
  scene: Object3D
  templateSkin: TemplateSkin | null
  hairline: unknown
  urgent: boolean
  owner: object | null
  promise: Promise<HairFitEntry>
  resolve: (entry: HairFitEntry) => void
  reject: (error: Error) => void
}

const queue: FitJob[] = []
const pending = new Map<string, FitJob>()
let running: FitJob | null = null

let worker: Worker | null = null
let local: ReturnType<typeof createHairFitHandler> | null = null
let nextId = 0
const replies = new Map<
  number,
  { resolve: (r: HairFitResponse) => void; reject: (e: Error) => void }
>()
/** Worker에 머리 정보를 보낸 머리(최근 순서). 머리 수만큼만 남긴다 */
const workerHeads: number[] = []
/** Worker가 가닥 대표 번호를 가진 헤어 메시 */
const sentStrands = new Set<string>()
const headIds = new WeakMap<Object3D, number>()
let nextHeadId = 0

function headIdOf(head: Object3D): number {
  let id = headIds.get(head)
  if (id === undefined) {
    id = ++nextHeadId
    headIds.set(head, id)
  }
  return id
}

function resetWorker() {
  worker?.terminate()
  worker = null
  local = null
  workerHeads.length = 0
  sentStrands.clear()
  for (const reply of replies.values()) reply.reject(new Error('헤어 맞춤을 그만뒀어요'))
  replies.clear()
}

/** 요청을 Worker(없으면 화면 스레드 처리 함수)로 보낸다 */
function send(
  message: HairFitRequest,
  transfer: Transferable[] = [],
): Promise<HairFitResponse> | null {
  if (!worker && !local && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./hairFit.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<HairFitResponse>) => {
        const reply = replies.get(event.data.id)
        replies.delete(event.data.id)
        reply?.resolve(event.data)
      }
      worker.onerror = () => {
        // 다음 요청에서 새 Worker를 띄운다(머리·가닥 정보도 다시 보낸다)
        resetWorker()
      }
    } catch {
      worker = null
    }
  }
  if (!worker) {
    local ??= createHairFitHandler()
    const out = local(message)
    return out ? Promise.resolve(out.response) : null
  }
  worker.postMessage(message, transfer)
  if (message.type !== 'fit') return null
  return new Promise((resolve, reject) => replies.set(message.id, { resolve, reject }))
}

function ensureHead(head: Object3D, input: HairHeadInput): number {
  const headId = headIdOf(head)
  const at = workerHeads.indexOf(headId)
  if (at >= 0) {
    workerHeads.splice(at, 1)
    workerHeads.push(headId)
    return headId
  }
  send({ type: 'head', headId, input })
  workerHeads.push(headId)
  while (workerHeads.length > HAIR_FIT_HEADS) send({ type: 'drop', headId: workerHeads.shift() })
  return headId
}

/**
 * 이 머리에 이 헤어를 맞춘 사본. 남겨 둔 것이 있으면 바로, 맞추는 중이면 그 결과를, 없으면 차례에 넣는다.
 * `urgent`(사용자가 고른 헤어)는 미리 맞추기보다 먼저 한다. 결과는 남겨 두므로 다시 고르면 바로 붙는다.
 */
export function fitHairFor(options: {
  head: Object3D
  hairline: unknown
  url: string
  scene: Object3D
  templateSkin: TemplateSkin | null
  urgent?: boolean
  /** 미리 맞추기를 그만둘 때 그 몫을 차례에서 뺀다(`cancelHairPrefits`) */
  owner?: object
}): Promise<HairFitEntry> {
  const { head, url, templateSkin, urgent = false } = options
  const key = hairFitKey(url, templateSkin)
  const cached = takeFit(head, key)
  if (cached) return Promise.resolve(cached)
  const jobKey = `${headIdOf(head)}|${key}`
  const existing = pending.get(jobKey)
  if (existing) {
    if (urgent && !existing.urgent) {
      existing.urgent = true
      existing.owner = null
      const at = queue.indexOf(existing)
      if (at > 0) {
        queue.splice(at, 1)
        queue.unshift(existing)
      }
    }
    return existing.promise
  }
  let resolve!: (entry: HairFitEntry) => void
  let reject!: (error: Error) => void
  const promise = new Promise<HairFitEntry>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  const job: FitJob = {
    ...options,
    key,
    urgent,
    owner: options.owner ?? null,
    promise,
    resolve,
    reject,
  }
  pending.set(jobKey, job)
  void promise.then(
    () => pending.delete(jobKey),
    () => pending.delete(jobKey),
  )
  if (urgent) {
    // 다른 사용자 요청 뒤, 미리 맞추기 앞
    const at = queue.findIndex((queued) => !queued.urgent)
    queue.splice(at < 0 ? queue.length : at, 0, job)
  } else queue.push(job)
  pump()
  return promise
}

/** 이 주인이 넣은 미리 맞추기 중 아직 시작하지 않은 것을 뺀다(뷰어가 닫힐 때) */
export function cancelHairPrefits(owner: object) {
  for (let i = queue.length - 1; i >= 0; i--) {
    const job = queue[i]
    if (job.owner !== owner) continue
    queue.splice(i, 1)
    job.reject(new Error('헤어 미리 맞추기를 그만뒀어요'))
  }
}

function pump() {
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = job
  runJob(job)
    .then(
      (entry) => job.resolve(keepFit(job.head, job.key, entry)),
      (error: unknown) =>
        job.reject(error instanceof Error ? error : new Error('헤어 맞춤 계산 실패')),
    )
    .finally(() => {
      running = null
      pump()
    })
}

async function runJob(job: FitJob): Promise<HairFitEntry> {
  const { head, scene, url, templateSkin } = job
  const info = hairHeadOf(head, job.hairline)
  const asset = hairAssetOfUrl(url)
  const edge = asset?.hairline ?? null
  const anchors =
    edge && info.curve.length ? hairlineAnchors(info.fit, info.curve, edge, info.pointOf) : []
  const input = headInputOf(info, templateSkin)
  const byRoot = asset?.skinFollow === 'root'
  if (!anchors.length && !input.ears.length && !input.surface && !(info.skin && templateSkin)) {
    return { scene, geometries: [], materials: new Map(), bytes: 0 }
  }
  const headId = ensureHead(head, input)

  // 헤어 장면의 사본: 메시 위치를 헤어 좌표(장면 루트 기준)로 바꿔 보내고, 맞춘 위치(메시 좌표)를 새로 담는다.
  // 원본 장면·지오메트리는 건드리지 않는다
  const copy = scene.clone(true)
  copy.position.set(0, 0, 0)
  copy.rotation.set(0, 0, 0)
  copy.scale.setScalar(1)
  copy.updateMatrixWorld(true)
  const meshes: { mesh: Mesh; geometry: BufferGeometry }[] = []
  const parts: Extract<HairFitRequest, { type: 'fit' }>['parts'] = []
  const transfer: ArrayBuffer[] = []
  copy.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const geometry = sharedCopy(object.geometry as BufferGeometry)
    const toHair = object.matrixWorld.clone()
    const xyz = hairPositions(geometry.getAttribute('position'), toHair)
    const toMesh = toHair.invert()
    const back = toMesh.clone().multiply(info.fromHead)
    const index = geometry.getIndex()
    const strandKey = byRoot && index ? `${url}#${meshes.length}` : null
    // 가닥 대표 번호는 Worker가 헤어마다 한 번 구해 남긴다. 처음 한 번만 삼각형 번호 사본을 옮겨 보낸다
    // (원본은 GPU에 올릴 지오메트리가 쓰니 옮기지 않는다)
    const strandIndex =
      strandKey && index && !sentStrands.has(strandKey) ? index.array.slice() : null
    if (strandIndex) transfer.push(strandIndex.buffer as ArrayBuffer)
    parts.push({
      xyz,
      toMesh: Array.from(toMesh.elements),
      back: Array.from(back.elements),
      strandKey,
      ...(strandIndex ? { index: strandIndex } : {}),
    })
    transfer.push(xyz.buffer)
    meshes.push({ mesh: object, geometry })
  })
  const id = ++nextId
  const earFit = byRoot ? (asset?.earFit ?? null) : null
  const reply = send({ type: 'fit', id, headId, anchors, byRoot, earFit, parts }, transfer)
  for (const part of parts) if (part.strandKey) sentStrands.add(part.strandKey)
  const response = await reply
  if (!response || response.type === 'error') {
    for (const part of parts) if (part.strandKey) sentStrands.delete(part.strandKey)
    throw new Error(response?.message ?? '헤어 맞춤 계산 실패')
  }
  let bytes = 0
  const geometries = meshes.map(({ mesh, geometry }, i) => {
    const { xyz, center, radius, index } = response.parts[i]
    geometry.setAttribute('position', new BufferAttribute(xyz, 3))
    // 귀에 맞춰 잘라 낸 가닥이 있으면 이 사본만 새 삼각형 번호를 쓴다(원본 번호는 원본 지오메트리가 쓴다)
    if (index) {
      geometry.setIndex(new BufferAttribute(index, 1))
      bytes += index.byteLength
    }
    geometry.boundingSphere = new Sphere(new Vector3(...center), radius)
    mesh.geometry = geometry
    bytes += xyz.byteLength
    return geometry
  })
  return { scene: copy, geometries, materials: new Map(), bytes }
}

// ---- three 객체에서 배열 읽기 ----

/**
 * 메시 위치를 헤어 좌표(xyz 연속)로 읽는다. 압축 GLB(KHR_mesh_quantization)는 위치가 정규화된 정수라 그 배열을 바로 풀어
 * 행렬(배율·이동)을 곱한다. 점마다 Vector3를 거치면 레이어드컷(570만 점)에서 맞춤 계산 시간의 15%를 썼다
 */
function hairPositions(position: BufferAttribute | InterleavedBufferAttribute, matrix: Matrix4) {
  const count = position.count
  const xyz = new Float32Array(count * 3)
  const e = matrix.elements
  if (!(position instanceof BufferAttribute) || position.itemSize !== 3) {
    for (let i = 0; i < count; i++) {
      xyz[i * 3] = position.getX(i)
      xyz[i * 3 + 1] = position.getY(i)
      xyz[i * 3 + 2] = position.getZ(i)
    }
    for (let i = 0; i < xyz.length; i += 3) {
      const x = xyz[i]
      const y = xyz[i + 1]
      const z = xyz[i + 2]
      xyz[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
      xyz[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
      xyz[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
    }
    return xyz
  }
  const source = position.array
  const unit = position.normalized ? normalizedUnit(source) : 1
  const low = source instanceof Int8Array || source instanceof Int16Array ? -1 : -Infinity
  for (let i = 0; i < count * 3; i += 3) {
    const x = Math.max(source[i] * unit, low)
    const y = Math.max(source[i + 1] * unit, low)
    const z = Math.max(source[i + 2] * unit, low)
    xyz[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    xyz[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    xyz[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  return xyz
}

/** 정규화 정수 배열의 1 단위(three MathUtils.denormalize와 같은 값) */
function normalizedUnit(array: ArrayLike<number>): number {
  if (array instanceof Int8Array) return 1 / 127
  if (array instanceof Uint8Array) return 1 / 255
  if (array instanceof Int16Array) return 1 / 32767
  if (array instanceof Uint16Array) return 1 / 65535
  if (array instanceof Int32Array) return 1 / 2147483647
  if (array instanceof Uint32Array) return 1 / 4294967295
  return 1
}

/** 헤어 좌표 → 머리 좌표 행렬(placeHairPoint와 같은 식: 배율, x축 기울기, 이동) */
function headMatrix(fit: HairFit): Matrix4 {
  const c = Math.cos(fit.rotationX)
  const s = Math.sin(fit.rotationX)
  const k = fit.scale
  const [px, py, pz] = fit.position
  return new Matrix4().set(k, 0, 0, px, 0, k * c, -k * s, py, 0, k * s, k * c, pz, 0, 0, 0, 1)
}

/**
 * 지오메트리 사본: 위치만 새로 담을 자리로 두고 삼각형·법선·색은 원본을 같이 쓴다. 레이어드컷은 삼각형 번호만 135MB라
 * 복사하면 메모리와 GPU 올리기가 두 배가 됐다. 사본을 버리면(dispose) 같이 쓰던 GPU 버퍼도 지워지지만, 다른 지오메트리가 그
 * 속성을 그리면 three가 다시 올린다
 */
function sharedCopy(original: BufferGeometry): BufferGeometry {
  const copy = new BufferGeometry()
  copy.setIndex(original.getIndex())
  for (const [name, attribute] of Object.entries(original.attributes)) {
    copy.setAttribute(name, attribute)
  }
  for (const group of original.groups) copy.addGroup(group.start, group.count, group.materialIndex)
  return copy
}

/** 피부 메시의 정점 위치·바깥 법선(장면 좌표). 원본 GLB 위치(편집 전)를 쓴다. 법선이 없으면 새로 구한다 */
function skinSurface(skin: Mesh): SkinSurface | null {
  const geometry = skin.geometry as BufferGeometry
  const position = geometry.getAttribute('position')
  if (!position?.count) return null
  let normal = geometry.getAttribute('normal')
  if (!normal) {
    const copy = geometry.clone()
    copy.computeVertexNormals()
    normal = copy.getAttribute('normal')
    copy.dispose()
  }
  const world = skin.matrixWorld
  const toWorldNormal = new Matrix3().getNormalMatrix(world)
  const points = new Float32Array(position.count * 3)
  const normals = new Float32Array(position.count * 3)
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
      .applyMatrix4(world)
      .toArray(points, i * 3)
    v.fromBufferAttribute(normal, i)
      .applyMatrix3(toWorldNormal)
      .normalize()
      .toArray(normals, i * 3)
  }
  return { points, normals }
}

/**
 * 사람 피부에서 귀 삼각형(세 점 모두 템플릿 귀 정점, gnm-skin.bin 귀 표시)의 장면 좌표(xyz 9개씩, S15P31B204-919).
 * 원본 GLB 위치(편집 전)를 쓴다. 템플릿 번호나 삼각형 번호가 없으면 빈 배열
 */
function earTriangles(skin: Mesh, templateSkin: TemplateSkin): Float32Array {
  const geometry = skin.geometry as BufferGeometry
  const ids = geometry.getAttribute('_TEMPLATE_INDEX') ?? geometry.getAttribute('_template_index')
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!ids || !position || !index) return new Float32Array(0)
  const ear = new Set<number>()
  for (let i = 0; i < templateSkin.ids.length; i++)
    if (templateSkin.ear[i]) ear.add(templateSkin.ids[i])
  const out: number[] = []
  const v = new Vector3()
  for (let t = 0; t + 2 < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    if (!tri.every((q) => ear.has(ids.getX(q)))) continue
    for (const q of tri)
      out.push(...v.fromBufferAttribute(position, q).applyMatrix4(skin.matrixWorld).toArray())
  }
  return new Float32Array(out)
}

/**
 * 피부 메시의 템플릿 점 번호 → 장면 좌표. 원본 GLB 위치(편집 전)를 쓴다.
 * UV 경계에서 한 템플릿 점이 여러 정점으로 나뉘어도 위치는 같으니 처음 것을 쓴다.
 */
function templatePoints(skin: Mesh): PointOf {
  const geometry = skin.geometry as BufferGeometry
  const ids = geometry.getAttribute('_TEMPLATE_INDEX') ?? geometry.getAttribute('_template_index')
  const position = geometry.getAttribute('position')
  if (!ids || !position || ids.count !== position.count) return () => null
  const index = new Map<number, number>()
  for (let i = 0; i < ids.count; i++) {
    const id = ids.getX(i)
    if (!index.has(id)) index.set(id, i)
  }
  const world: Matrix4 = skin.matrixWorld
  return (vertex) => {
    const i = index.get(vertex)
    if (i === undefined) return null
    return new Vector3().fromBufferAttribute(position, i).applyMatrix4(world).toArray()
  }
}
