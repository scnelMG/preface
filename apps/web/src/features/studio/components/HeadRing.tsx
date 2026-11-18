'use client'

import dynamic from 'next/dynamic'
import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
import { preload } from 'react-dom'
import { getFaceModel } from '../api'
import type { HeadOption } from '../heads'
import type { CenterZone, RingDrive, RingItem } from './HeadRingScene'
import { clampDrag, mod, nearestSlot, ringLoops, settleSlot, slotOffset } from './ringMath'

const Scene = dynamic(() => import('./HeadRingScene'), { ssr: false })

/**
 * 머리 고리(2026-10-31). 작업실 가운데 무대를 3D 캔버스 하나로 그린다(장면은 HeadRingScene).
 *
 * - 돌리기: 가로로 끌기(놓으면 미끄러지다 가까운 머리에 멈춘다), 트랙패드 가로 스크롤, 옆 머리 누르기,
 *   그리고 바깥(HeadPicker)의 이전·다음 버튼·방향키·전환 바. 세로 스크롤은 막지 않는다(페이지 스크롤 그대로).
 * - 가운데 머리를 누르면 `onOpen`(편집하기와 같다, -605). 3D 표면이 아니라 화면 위치로 정한다: 가운데 머리가 고개를
 *   좌우로 돌릴 때의 최대 범위(`CenterZone`) 안이면 옆 머리·빈 곳에 닿아도 들어간다(-799). 그 바깥의 옆 머리는 돌리기.
 * - 머리 하나에 칸 하나다(-527). 셋 이상은 고리로 돌고, 둘은 가운데와 옆 하나로 줄처럼 놓는다. 하나면 가운데 하나만.
 * - 메시 주소: 기본 모델은 정적 자산, 내 모델은 API-HIS-02로 가운데와 양옆만 받는다(먼 머리는 받지 않는다).
 * - WebGL이 없거나 장면이 깨지면 `fallback`(예전 가운데 3D)을 그린다.
 */
export function HeadRing({
  options,
  index,
  onSelect,
  onOpen,
  fallback,
}: {
  options: readonly HeadOption[]
  index: number
  onSelect: (id: string) => void
  /** 가운데 머리를 눌렀다(편집하기와 같다, -605) */
  onOpen?: () => void
  fallback: ReactNode
}) {
  const webgl = useSyncExternalStore(noop, canUseWebGL, () => false)
  if (!webgl) return <>{fallback}</>
  return (
    <RingBoundary fallback={fallback}>
      <Ring options={options} index={index} onSelect={onSelect} onOpen={onOpen} />
    </RingBoundary>
  )
}

function Ring({
  options,
  index,
  onSelect,
  onOpen,
}: {
  options: readonly HeadOption[]
  index: number
  onSelect: (id: string) => void
  onOpen?: () => void
}) {
  const count = options.length
  const drive = useRef<RingDrive>({ pos: index, target: index, dragging: false })
  const invalidate = useRef<() => void>(() => {})
  const root = useRef<HTMLDivElement>(null)
  const reduced = useSyncExternalStore(subscribeMotion, readReduced, () => false)
  const visible = useInView(root)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set())
  const centerZone = useRef<CenterZone | null>(null)
  /** 방금 끌다 놓았다. 놓을 때 따라오는 click을 누르기로 치지 않는다 */
  const dragged = useRef(false)
  const lastCount = useRef(count)

  // 바깥에서 고른 모델로 간다: 지금 위치에서 가장 가까운 같은 머리 칸
  useEffect(() => {
    const d = drive.current
    // 머리 수가 바뀌었다(삭제 등): 칸 번호 체계가 바뀌니 돌지 않고 그 자리에 맞춘다(-799)
    if (lastCount.current !== count) {
      lastCount.current = count
      d.pos = index
      d.target = index
      invalidate.current()
      return
    }
    if ((ringLoops(count) ? mod(d.target, count) : d.target) === index) return
    d.target = nearestSlot(d.pos, index, count)
    if (reduced) d.pos = d.target
    invalidate.current()
  }, [index, count, reduced])

  const needed = new Set(
    count <= 3
      ? options.map((o) => o.id)
      : [-1, 0, 1].map((d) => options[mod(index + d, count)].id),
  )
  const urls = useMeshUrls(options, needed)
  // 기본 모델 GLB(약 5MB)는 3D 장면 코드(three·drei)를 받는 동안 미리 받기 시작한다(-527).
  // 장면의 GLTFLoader가 같은 주소를 같은 방식(cors, 쿠키 없음)으로 fetch해 이 응답을 그대로 쓴다
  for (const option of options)
    if (option.kind === 'sample' && needed.has(option.id))
      preload(option.sample.meshUrl, { as: 'fetch', crossOrigin: 'anonymous' })
  // 머리 id로 구분한다. 삭제로 칸이 당겨져도 남은 머리를 다시 불러오지 않는다(-799)
  const items: RingItem[] = options.map((option) => ({
    key: option.id,
    url: urls.get(option.id) ?? null,
  }))
  const centerReady = loaded.has(options[index].id)
  const markLoaded = useCallback(
    (slot: number) =>
      setLoaded((prev) => {
        const id = options[mod(slot, count)].id
        return prev.has(id) ? prev : new Set(prev).add(id)
      }),
    [count, options],
  )
  const keepInvalidate = useCallback((fn: () => void) => {
    invalidate.current = fn
  }, [])

  const settle = useCallback(
    (target: number) => {
      const d = drive.current
      d.dragging = false
      d.target = target
      if (reduced) d.pos = target
      invalidate.current()
      onSelect(options[mod(target, count)].id)
    },
    [count, onSelect, options, reduced],
  )

  /** 화면 좌표가 가운데 머리 누르기 구역 안인가 */
  const inCenterZone = (clientX: number, clientY: number) => {
    const zone = centerZone.current
    const rect = root.current?.getBoundingClientRect()
    if (!zone || !rect) return false
    const x = clientX - rect.left
    const y = clientY - rect.top
    return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom
  }
  /** 멈춰 있다(돌아가는 중에 누른 것은 들어가지 않는다) */
  const resting = () =>
    !drive.current.dragging && Math.abs(drive.current.pos - drive.current.target) < 0.3

  // 끌기: 6px 넘게 움직이면 그때부터 잡는다(그 전에는 옆 머리 누르기가 장면으로 간다)
  const gesture = useRef<{
    x: number
    pos: number
    lastX: number
    lastT: number
    velocity: number
    active: boolean
  } | null>(null)
  const perSlot = () => Math.max(120, (root.current?.clientWidth ?? 800) * 0.3)

  useEffect(() => {
    const element = root.current
    if (!element || count < 2) return
    // 트랙패드 가로 스크롤로 돌린다. 세로 스크롤은 그대로 페이지로 보낸다
    let timer = 0
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      const d = drive.current
      d.dragging = true
      d.pos = clampDrag(d.pos + event.deltaX / perSlot(), count)
      invalidate.current()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => settle(settleSlot(drive.current.pos, count)), 140)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      window.clearTimeout(timer)
    }
  }, [count, settle])

  return (
    <div
      ref={root}
      className="pf-ring"
      onClick={(event) => {
        // 가운데 구역 누르기는 장면(3D)에 닿았든 안 닿았든 여기서 들어간다
        if (dragged.current) return
        if (inCenterZone(event.clientX, event.clientY) && resting()) onOpen?.()
      }}
      onPointerDown={(event) => {
        dragged.current = false
        if (count < 2 || event.button !== 0) return
        gesture.current = {
          x: event.clientX,
          pos: drive.current.pos,
          lastX: event.clientX,
          lastT: event.timeStamp,
          velocity: 0,
          active: false,
        }
      }}
      onPointerMove={(event) => {
        const g = gesture.current
        if (!g) return
        const dx = event.clientX - g.x
        if (!g.active) {
          if (Math.abs(dx) < 6) return
          g.active = true
          drive.current.dragging = true
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.dataset.dragging = ''
        }
        const dt = Math.max(1, event.timeStamp - g.lastT)
        g.velocity = (event.clientX - g.lastX) / dt
        g.lastX = event.clientX
        g.lastT = event.timeStamp
        drive.current.pos = clampDrag(g.pos - dx / perSlot(), count)
        invalidate.current()
      }}
      onPointerUp={(event) => {
        const g = gesture.current
        gesture.current = null
        delete event.currentTarget.dataset.dragging
        if (!g?.active) return
        dragged.current = true
        // 놓을 때의 속도만큼 조금 더 미끄러진 자리에서 가장 가까운 머리
        const projected = drive.current.pos - (g.velocity * 220) / perSlot()
        settle(settleSlot(projected, count))
      }}
      onPointerCancel={(event) => {
        gesture.current = null
        delete event.currentTarget.dataset.dragging
        settle(settleSlot(drive.current.pos, count))
      }}
    >
      <Scene
        items={items}
        drive={drive}
        sway={!reduced && visible}
        centerZone={centerZone}
        onPick={(slot, clientX, clientY) => {
          // 가운데 구역이면 위 onClick이 들어간다. 옆 머리에 닿았어도 돌리지 않는다
          if (inCenterZone(clientX, clientY)) return
          // 가운데 머리(멈춰 있을 때)는 편집하기, 옆 머리는 가운데로 돌린다
          if (Math.abs(slotOffset(slot, drive.current.pos, count)) <= 0.4) {
            if (!drive.current.dragging) onOpen?.()
            return
          }
          settle(nearestSlot(drive.current.pos, mod(slot, count), count))
        }}
        onLoaded={markLoaded}
        onReady={keepInvalidate}
      />
      {/* 가운데 머리를 받는 동안은 3D 자리와 같은 가는 고리 하나 */}
      {centerReady ? null : (
        <div className="pf-ring-loading" aria-busy="true">
          <span className="pf-loader" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

/** 가운데·양옆 머리의 메시 주소. 내 모델은 한 번 받은 주소를 기억한다(presigned 10분) */
function useMeshUrls(options: readonly HeadOption[], needed: ReadonlySet<string>) {
  // 내 모델 id → 메시 주소
  const [own, setOwn] = useState<ReadonlyMap<string, string>>(() => new Map())
  /** 이미 부탁한 내 모델. 응답 하나가 올 때마다 나머지를 끊고 다시 부르지 않게 따로 기억한다(-799) */
  const requested = useRef(new Set<string>())
  const controllers = useRef(new Set<AbortController>())
  const wanted = options
    .filter((o) => o.kind === 'own' && needed.has(o.id) && !own.has(o.faceModelId))
    .map((o) => (o.kind === 'own' ? o.faceModelId : ''))
    .join(',')

  useEffect(() => {
    if (!wanted) return
    for (const faceModelId of wanted.split(',')) {
      if (requested.current.has(faceModelId)) continue
      requested.current.add(faceModelId)
      const controller = new AbortController()
      controllers.current.add(controller)
      getFaceModel(faceModelId, controller.signal)
        .then((detail) => setOwn((prev) => new Map(prev).set(faceModelId, detail.meshUrl)))
        .catch(() => {
          // 주소를 못 받은 머리는 고리에서 비워 둔다. 편집하기에서 다시 받는다
        })
        .finally(() => controllers.current.delete(controller))
    }
  }, [wanted])

  // 화면을 떠날 때만 진행 중인 요청을 끊는다
  useEffect(() => {
    const pending = controllers.current
    const asked = requested.current
    return () => {
      for (const controller of pending) controller.abort()
      pending.clear()
      // 다시 돌아오면(cacheComponents) 끊긴 것을 다시 부를 수 있게
      asked.clear()
    }
  }, [])

  const urls = new Map<string, string>()
  for (const option of options) {
    if (option.kind === 'sample') urls.set(option.id, option.sample.meshUrl)
    else {
      const url = own.get(option.faceModelId)
      if (url) urls.set(option.id, url)
    }
  }
  return urls
}

function useInView(ref: RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return visible
}

class RingBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const noop = () => () => {}
/** 한 번만 재고 기억한다(매번 캔버스를 만들면 WebGL 문맥이 쌓인다) */
let webglSupported: boolean | null = null
function canUseWebGL() {
  if (webglSupported !== null) return webglSupported
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webglSupported = !!context
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webglSupported = false
  }
  return webglSupported
}

function subscribeMotion(listener: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
function readReduced() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
