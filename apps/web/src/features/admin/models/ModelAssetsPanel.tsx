'use client'

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { PRIVATE_MEDIA } from '@/shared/analytics'
import { cx, Segmented } from '@/shared/ui'
import { createCameraLink } from './cameraLink'
import {
  ANGLE_LABEL,
  CAPTURE_ANGLES,
  EMPTY_QUALITY,
  isCaptureAngle,
  type CaptureAngle,
  type CaptureQuality,
} from './captureQuality'
import { readCamera, resolveCamera, SOURCE_LABEL, type CompareCamera } from './compareCamera'
import { CompareViewer } from './CompareViewerLoader'
import { ModelDownloads } from './ModelDownloads'
import type { AdminCaptureImage, AdminFaceModelAssets } from './types'

export const CAPTURES_HIDDEN = '운영에서는 촬영 사진을 보여 주지 않아요(처리방침 개정 전)'
export const NO_TEXTURED_MESH = '텍스처 메시가 없어요'
export const GRAY_CAPTION = '텍스처 메시를 회색으로 그린 것(형상은 같다)'
export const BASE_MESH_CAPTION = '텍스처 전 메시를 회색으로 그린 것'
export const QUALITY_LOADING = '카메라 정보를 불러오는 중이에요'
export const QUALITY_FAILED = '카메라 정보를 불러오지 못해 기본 방향으로 보여요'

/** 작업 상세(`input.quality`)에서 읽은 카메라 정보. 부모가 모델을 열 때 받는다 */
export type QualityLoad =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: CaptureQuality }

type Mode = 'side' | 'overlay'
type OverlayTarget = 'textured' | 'gray'
type PhotoSize = { width: number; height: number }
/** 겹쳐 보기에서 손으로 맞춘 사진 위치(칸 크기 대비 비율)·배율 */
type PhotoNudge = { x: number; y: number; scale: number }

const NO_NUDGE: PhotoNudge = { x: 0, y: 0, scale: 1 }
const DEFAULT_ASPECT = 3 / 4
const MODE_OPTIONS = [
  { value: 'side', label: '나란히' },
  { value: 'overlay', label: '겹쳐 보기' },
] as const
const TARGET_OPTIONS = [
  { value: 'textured', label: '텍스처' },
  { value: 'gray', label: '회색' },
] as const
const ANGLE_OPTIONS = CAPTURE_ANGLES.map((angle) => ({ value: angle, label: ANGLE_LABEL[angle] }))

function label(angle: string) {
  const key = angle.toUpperCase()
  return isCaptureAngle(key) ? ANGLE_LABEL[key] : angle
}

function sortByAngle(images: AdminCaptureImage[]) {
  const rank = (angle: string) => {
    const index = (CAPTURE_ANGLES as readonly string[]).indexOf(angle.toUpperCase())
    return index < 0 ? CAPTURE_ANGLES.length : index
  }
  return [...images].sort((a, b) => rank(a.angle) - rank(b.angle))
}

/**
 * 선택한 모델의 자산(계약 7)과 촬영 사진 비교(S15P31B204-706).
 *
 * - 방향(왼쪽~오른쪽)을 고르면 촬영 사진 · 텍스처 3D · 형상(회색) 3D를 같은 카메라로 나란히, 또는 사진을 3D 위에 겹쳐 본다.
 * - 카메라는 사진 카메라(qualityReport.captureCameras) → 각도(captureViews) → 기본 방향 순으로 쓴다(`compareCamera.ts`).
 * - 형상(회색)은 텍스처 전 메시를 아직 저장하지 않아 텍스처 메시를 회색 재질로 그린다(같은 형상).
 *
 * - 텍스처 GLB와 회색 형상 GLB(브라우저에서 만든다)를 내려받을 수 있다(S15P31B204-720, `ModelDownloads`).
 *
 * 서명 URL은 props로만 흐르고 주소창·저장소·로그에 남기지 않는다.
 */
export function ModelAssetsPanel({
  assets,
  quality = { status: 'ready', data: EMPTY_QUALITY },
  onAssetsRefreshed,
}: {
  assets: AdminFaceModelAssets
  quality?: QualityLoad
  /** 내려받기 중 서명 URL이 만료돼 자산을 다시 받았을 때 */
  onAssetsRefreshed?: (assets: AdminFaceModelAssets) => void
}) {
  const [angle, setAngle] = useState<CaptureAngle>('FRONT')
  const [mode, setMode] = useState<Mode>('side')
  const [target, setTarget] = useState<OverlayTarget>('textured')
  const [opacity, setOpacity] = useState(0.5)
  const [nudge, setNudge] = useState<{ angle: CaptureAngle; value: PhotoNudge } | null>(null)
  const [photoSizes, setPhotoSizes] = useState<Partial<Record<CaptureAngle, PhotoSize>>>({})
  const link = useMemo(() => createCameraLink(), [])

  const data = quality.status === 'ready' ? quality.data : EMPTY_QUALITY
  const photos = useMemo(() => {
    const out: Partial<Record<CaptureAngle, string>> = {}
    for (const image of assets.captureImages) {
      const key = image.angle.toUpperCase()
      if (isCaptureAngle(key) && !out[key]) out[key] = image.url
    }
    return out
  }, [assets.captureImages])
  const hasPhotos = assets.captureImages.length > 0
  const photo = photos[angle] ?? null
  const photoSize = photoSizes[angle] ?? null
  const camera = useMemo(() => resolveCamera(angle, data, photoSize), [angle, data, photoSize])
  const aspect = camera.aspect ?? (photoSize ? photoSize.width / photoSize.height : DEFAULT_ASPECT)
  const grayUrl = assets.baseMeshUrl ?? assets.texturedMeshUrl
  const currentMode: Mode = photo ? mode : 'side'
  const currentNudge = nudge?.angle === angle ? nudge.value : NO_NUDGE

  function rememberSize(key: string, image: HTMLImageElement) {
    const upper = key.toUpperCase()
    if (!isCaptureAngle(upper) || !image.naturalWidth || !image.naturalHeight) return
    const size = { width: image.naturalWidth, height: image.naturalHeight }
    setPhotoSizes((prev) =>
      prev[upper]?.width === size.width && prev[upper]?.height === size.height
        ? prev
        : { ...prev, [upper]: size },
    )
  }

  const viewer = (gray: boolean) => {
    const url = gray ? grayUrl : assets.texturedMeshUrl
    return url ? (
      <CompareViewer
        meshUrl={url}
        gray={gray}
        camera={camera}
        orbit={camera.kind !== 'exact' && currentMode === 'side'}
        link={link}
        label={`${ANGLE_LABEL[angle]} ${gray ? '회색' : '텍스처'} 3D 모델`}
      />
    ) : (
      <Placeholder>{NO_TEXTURED_MESH}</Placeholder>
    )
  }

  return (
    <div className="flex flex-col gap-(--space-24)">
      {assets.texturedMeshUrl ? (
        <ModelDownloads assets={assets} onRefreshed={onAssetsRefreshed} />
      ) : null}
      <section className="flex flex-col gap-(--space-12)" aria-label="사진과 비교">
        <div className="flex flex-wrap items-center gap-(--space-12)">
          <Segmented
            options={ANGLE_OPTIONS}
            value={angle}
            onChange={setAngle}
            label="방향"
            mode="toggle"
            size="sm"
          />
          {hasPhotos ? (
            <Segmented
              options={MODE_OPTIONS}
              value={currentMode}
              onChange={setMode}
              label="보기 방식"
              mode="toggle"
              size="sm"
            />
          ) : null}
        </div>
        <p className="type-caption text-text-muted" data-camera-source={camera.kind}>
          카메라: <span className="text-text-ink">{SOURCE_LABEL[camera.kind]}</span>
          {camera.kind === 'exact'
            ? ' · 회전을 끄고 촬영 카메라 위치·화각 그대로 그려요'
            : camera.kind === 'approx'
              ? ' · 머리 각도만 맞췄어요. 겹쳐 보기에서 사진을 끌어 맞출 수 있어요'
              : ''}
        </p>
        {quality.status === 'loading' ? (
          <p className="type-caption text-text-muted" role="status">
            {QUALITY_LOADING}
          </p>
        ) : quality.status === 'error' ? (
          <p className="type-caption text-status-danger">{QUALITY_FAILED}</p>
        ) : null}
        {!hasPhotos ? (
          <p className="type-kr-body-13-regular-lh16p9 text-text-muted">{CAPTURES_HIDDEN}</p>
        ) : null}

        {currentMode === 'side' ? (
          <div
            className={cx(
              'grid grid-cols-1 gap-(--space-16)',
              hasPhotos ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
            )}
          >
            {hasPhotos ? (
              <Slot title="촬영 사진" aspect={aspect}>
                {photo ? (
                  <Photo
                    url={photo}
                    alt={`${ANGLE_LABEL[angle]} 비교 사진`}
                    onSize={(img) => rememberSize(angle, img)}
                  />
                ) : (
                  <Placeholder>이 방향 사진이 없어요</Placeholder>
                )}
              </Slot>
            ) : null}
            <Slot title="텍스처 메시" aspect={aspect}>
              {viewer(false)}
            </Slot>
            <Slot
              title="형상(회색)"
              caption={assets.baseMeshUrl ? BASE_MESH_CAPTION : GRAY_CAPTION}
              aspect={aspect}
            >
              {viewer(true)}
            </Slot>
          </div>
        ) : (
          <div className="flex flex-col gap-(--space-12)">
            <div className="flex flex-wrap items-center gap-(--space-16)">
              <Segmented
                options={TARGET_OPTIONS}
                value={target}
                onChange={setTarget}
                label="겹칠 3D"
                mode="toggle"
                size="sm"
              />
              <label className="type-caption flex items-center gap-(--space-8) text-text-muted">
                사진 불투명도
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  aria-label="사진 불투명도"
                  onChange={(event) => setOpacity(Number(event.target.value) / 100)}
                  className="w-40 accent-brand-violet"
                />
                <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
              </label>
              {camera.kind !== 'exact' ? (
                <>
                  <label className="type-caption flex items-center gap-(--space-8) text-text-muted">
                    사진 크기
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={1}
                      aria-label="사진 크기"
                      value={Math.round(currentNudge.scale * 100)}
                      onChange={(event) =>
                        setNudge({
                          angle,
                          value: { ...currentNudge, scale: Number(event.target.value) / 100 },
                        })
                      }
                      className="w-32 accent-brand-violet"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setNudge(null)}
                    className="type-label min-h-11 text-text-ink underline"
                  >
                    사진 위치 되돌리기
                  </button>
                </>
              ) : null}
            </div>
            <div className="w-full max-w-md">
              <Slot
                title={target === 'gray' ? '사진 + 형상(회색)' : '사진 + 텍스처 메시'}
                caption={target === 'gray' ? GRAY_CAPTION : undefined}
                aspect={aspect}
              >
                {viewer(target === 'gray')}
                {photo ? (
                  <OverlayPhoto
                    url={photo}
                    alt={`${ANGLE_LABEL[angle]} 겹친 사진`}
                    opacity={opacity}
                    nudge={currentNudge}
                    movable={camera.kind !== 'exact'}
                    onNudge={(value) => setNudge({ angle, value })}
                    onSize={(img) => rememberSize(angle, img)}
                  />
                ) : null}
              </Slot>
            </div>
          </div>
        )}

        {data.cameras ? <CameraTable quality={data} selected={angle} /> : null}
      </section>

      <section className="flex flex-col gap-(--space-12)" aria-label="5방향 촬영 사진">
        <h3 className="type-label text-text-ink">5방향 촬영 사진</h3>
        {!hasPhotos ? (
          <p className="type-kr-body-13-regular-lh16p9 text-text-muted">{CAPTURES_HIDDEN}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-(--space-12) sm:grid-cols-3 md:grid-cols-5">
            {sortByAngle(assets.captureImages).map((image, index) => (
              <li key={`${image.angle}-${index}`} className="flex flex-col gap-(--space-6)">
                <div
                  {...PRIVATE_MEDIA}
                  className="aspect-3/4 overflow-hidden rounded-7 border border-line-default bg-bg-stone"
                >
                  {/* 서명 URL이라 next/image 최적화 서버를 거치지 않는다. Referer도 보내지 않는다 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={`${label(image.angle)} 촬영 사진`}
                    referrerPolicy="no-referrer"
                    decoding="async"
                    onLoad={(event) => rememberSize(image.angle, event.currentTarget)}
                    className="size-full object-cover"
                  />
                </div>
                <span className="type-caption text-text-muted">{label(image.angle)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Slot({
  title,
  caption,
  aspect,
  children,
}: {
  title: string
  caption?: string
  aspect: number
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-(--space-8)" aria-label={title}>
      <div className="flex flex-col gap-(--space-2)">
        <h3 className="type-label text-text-ink">{title}</h3>
        {caption ? <p className="type-caption text-text-muted">{caption}</p> : null}
      </div>
      <div
        {...PRIVATE_MEDIA}
        className="relative w-full overflow-hidden rounded-7 border border-line-default bg-bg-surface"
        // 사진 비율은 데이터라 토큰 클래스로 쓸 수 없다. 3D 칸도 같은 비율이어야 사진과 같은 화면이 된다
        style={{ aspectRatio: String(aspect) }}
      >
        {children}
      </div>
    </section>
  )
}

function Photo({
  url,
  alt,
  onSize,
}: {
  url: string
  alt: string
  onSize: (image: HTMLImageElement) => void
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      onLoad={(event) => onSize(event.currentTarget)}
      // 칸 비율이 사진 비율과 같아 늘어나지 않는다. 사진 카메라 그대로일 때 3D 칸과 픽셀이 맞는다
      className="size-full object-fill"
    />
  )
}

/** 3D 위에 겹친 사진. 사진 카메라가 아니면 끌어서 옮기고 크기를 바꿀 수 있다 */
function OverlayPhoto({
  url,
  alt,
  opacity,
  nudge,
  movable,
  onNudge,
  onSize,
}: {
  url: string
  alt: string
  opacity: number
  nudge: PhotoNudge
  movable: boolean
  onNudge: (value: PhotoNudge) => void
  onSize: (image: HTMLImageElement) => void
}) {
  const drag = useRef<{ x: number; y: number; start: PhotoNudge; w: number; h: number } | null>(
    null,
  )
  function down(event: ReactPointerEvent<HTMLImageElement>) {
    if (!movable) return
    const box = event.currentTarget.parentElement?.getBoundingClientRect()
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      start: nudge,
      w: box?.width || 1,
      h: box?.height || 1,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  function move(event: ReactPointerEvent<HTMLImageElement>) {
    const d = drag.current
    if (!d) return
    onNudge({
      ...d.start,
      x: d.start.x + (event.clientX - d.x) / d.w,
      y: d.start.y + (event.clientY - d.y) / d.h,
    })
  }
  function up() {
    drag.current = null
  }
  const transform = movable
    ? `translate(${nudge.x * 100}%, ${nudge.y * 100}%) scale(${nudge.scale})`
    : undefined
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      referrerPolicy="no-referrer"
      decoding="async"
      draggable={false}
      onLoad={(event) => onSize(event.currentTarget)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      className={cx(
        'absolute inset-0 size-full object-fill select-none',
        movable ? 'cursor-move touch-none' : 'pointer-events-none',
      )}
      style={{ opacity, transform }}
    />
  )
}

function fixed(value: number, digits: number) {
  const out = value.toFixed(digits)
  return out === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : out
}

/** 사진마다 카메라 값(GLB 원점 기준). yaw·pitch는 captureViews와 같은 부호 */
function CameraTable({ quality, selected }: { quality: CaptureQuality; selected: CaptureAngle }) {
  const rows = CAPTURE_ANGLES.map((angle) => {
    const camera: CompareCamera | null = quality.cameras?.views[angle]
      ? resolveCamera(angle, quality, null)
      : null
    return { angle, readout: camera ? readCamera(camera) : null }
  })
  return (
    <div className="overflow-x-auto">
      <table className="type-kr-body-12-regular-lh15p6 w-full min-w-max border-collapse text-left text-text-body">
        <caption className="type-caption pb-(--space-6) text-left text-text-muted">
          사진 카메라 값 · 거리는 GLB 원점까지(GLB 단위), yaw 음수 = 왼쪽, pitch 양수 = 위에서, roll
          양수 = 화면에서 위쪽이 오른쪽으로 기욺
        </caption>
        <thead>
          <tr className="type-kr-caption-11-medium-lh14p3 border-b border-line-default text-text-muted">
            <th className="py-(--space-6) pr-(--space-16) font-medium">방향</th>
            <th className="py-(--space-6) pr-(--space-16) font-medium">거리</th>
            <th className="py-(--space-6) pr-(--space-16) font-medium">yaw</th>
            <th className="py-(--space-6) pr-(--space-16) font-medium">pitch</th>
            <th className="py-(--space-6) pr-(--space-16) font-medium">roll</th>
            <th className="py-(--space-6) font-medium">세로 화각</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ angle, readout }) => (
            <tr
              key={angle}
              data-angle={angle}
              className={cx('border-b border-line-default', angle === selected && 'bg-bg-stone')}
            >
              <td className="py-(--space-6) pr-(--space-16)">{ANGLE_LABEL[angle]}</td>
              {readout ? (
                <>
                  <td className="py-(--space-6) pr-(--space-16) tabular-nums">
                    {fixed(readout.distance, 3)}
                  </td>
                  <td className="py-(--space-6) pr-(--space-16) tabular-nums">
                    {fixed(readout.yaw, 1)}°
                  </td>
                  <td className="py-(--space-6) pr-(--space-16) tabular-nums">
                    {fixed(readout.pitch, 1)}°
                  </td>
                  <td className="py-(--space-6) pr-(--space-16) tabular-nums">
                    {fixed(readout.roll, 1)}°
                  </td>
                  <td className="py-(--space-6) tabular-nums">{fixed(readout.fovDeg, 1)}°</td>
                </>
              ) : (
                <td colSpan={5} className="py-(--space-6) text-text-muted">
                  카메라 없음(사진이 복원에 쓰이지 않았어요)
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-full items-center justify-center p-(--space-20) text-center">
      <p className="type-kr-body-13-regular-lh16p9 break-keep text-text-muted">{children}</p>
    </div>
  )
}
