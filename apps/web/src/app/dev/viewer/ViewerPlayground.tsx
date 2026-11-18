'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MorphParameterCatalog } from '@/features/edit/types'
import { useEditStore } from '@/features/edit/store'
import { BASE_MODEL_MESH_URL } from '@/features/viewer/assets'
import { FaceStage } from '@/features/viewer/FaceStage'
import type { ViewerStatus } from '@/features/viewer/types'
import { DEFAULT_VIEW_PRESET, isViewPreset, type ViewPreset } from '@/features/viewer/viewPresets'
import { Checkbox, SliderRow, Tab, TabList } from '@/shared/ui'

/**
 * API-EDIT-01 응답 예시(명세서 v2.9) 중 NOSE. 와이어프레임 v3.2 슬라이더 3줄(콧대 높이·코끝·콧볼 너비).
 * 실제 화면(-156)은 API로 받는다.
 */
const CATALOG: MorphParameterCatalog = {
  schemaVersion: 'v1',
  parts: [
    {
      part: 'NOSE',
      label: '코',
      items: [
        {
          code: 'nose.bridge_height',
          subPart: 'BRIDGE',
          label: '콧대 높이',
          min: -0.5,
          max: 0.8,
          default: 0,
          step: 0.05,
        },
        {
          code: 'nose.tip_height',
          subPart: 'TIP',
          label: '코끝',
          min: -0.5,
          max: 0.5,
          default: 0,
          step: 0.05,
        },
        {
          code: 'nose.alar_width',
          subPart: 'ALAR',
          label: '콧볼 너비',
          min: -0.5,
          max: 0.5,
          default: 0,
          step: 0.05,
        },
      ],
    },
  ],
}

type Source = 'synthetic' | 'base' | 'broken'

const SOURCES: { value: Source; label: string }[] = [
  { value: 'synthetic', label: '합성 GLB' },
  { value: 'base', label: '기본 모델 경로' },
  { value: 'broken', label: '깨진 주소' },
]

/** 합성 머리를 브라우저에서 GLB로 내보내 blob 주소로 만든다. three는 여기서만 동적으로 불러온다 */
async function createSyntheticGlbUrl(): Promise<string> {
  const [{ createSyntheticHead }, { GLTFExporter }] = await Promise.all([
    import('@/features/viewer/syntheticHead'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ])
  const glb = await new GLTFExporter().parseAsync(createSyntheticHead(), { binary: true })
  return URL.createObjectURL(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }))
}

export function ViewerPlayground() {
  const [source, setSource] = useState<Source>('synthetic')
  const [syntheticUrl, setSyntheticUrl] = useState('')
  const [compare, setCompare] = useState(true)
  // 헤드리스 스크린샷용 ?view=front|side. FaceStage가 처음 렌더할 때만 읽는다(합성 GLB가 준비된 뒤라 클라이언트)
  const [initialView] = useState<ViewPreset>(() => {
    if (typeof window === 'undefined') return DEFAULT_VIEW_PRESET
    const view = new URLSearchParams(window.location.search).get('view') ?? ''
    return isViewPreset(view) ? view : DEFAULT_VIEW_PRESET
  })
  const [status, setStatus] = useState<ViewerStatus>('loading')
  const [unsupported, setUnsupported] = useState<string[]>([])

  const weights = useEditStore((s) => s.morphState.weights)
  const setWeight = useEditStore((s) => s.setWeight)

  useEffect(() => {
    let url = ''
    let canceled = false
    createSyntheticGlbUrl().then((created) => {
      if (canceled) return URL.revokeObjectURL(created)
      url = created
      setSyntheticUrl(created)
      const src = new URLSearchParams(window.location.search).get('src')
      if (src === 'base' || src === 'broken') setSource(src)
    })
    return () => {
      canceled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  // 헤드리스 스크린샷용: ?src=base|broken&w=nose.bridge_height:0.8,nose.alar_width:-0.5
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    for (const pair of (params.get('w') ?? '').split(',').filter(Boolean)) {
      const [code, value] = pair.split(':')
      if (code && Number.isFinite(Number(value))) setWeight(code, Number(value))
    }
  }, [setWeight])

  const onUnsupported = useCallback(
    (codes: string[]) => setUnsupported((prev) => (prev.join() === codes.join() ? prev : codes)),
    [],
  )

  const meshUrl =
    source === 'synthetic'
      ? syntheticUrl
      : source === 'base'
        ? BASE_MODEL_MESH_URL
        : '/dev/viewer/missing.glb'

  return (
    <main className="bg-bg-paper text-text-ink md:flex md:h-dvh">
      <div className="h-dvh md:h-auto md:min-w-0 md:flex-1">
        {meshUrl ? (
          <FaceStage
            meshUrl={meshUrl}
            weights={weights}
            compare={compare}
            defaultView={initialView}
            onStatusChange={setStatus}
            onUnsupportedCodes={onUnsupported}
          />
        ) : (
          <p className="p-(--space-24) type-kr-body-12-regular-lh15p6">합성 GLB를 만드는 중</p>
        )}
      </div>

      <aside className="flex flex-col gap-(--space-24) border-line-default p-(--space-22) md:w-96 md:overflow-y-auto md:border-l">
        <div>
          <p className="type-en-micro-8-medium-ls1p8-lh10p4 text-text-body">DEV · S15P31B204-276</p>
          <h1 className="type-kr-body-13-regular-lh16p9 mt-(--space-8)">3D 뷰어 확인</h1>
        </div>

        <TabList
          variant="bar"
          value={source}
          onChange={(v) => setSource(v as Source)}
          aria-label="메시"
          className="gap-(--space-16)"
        >
          {SOURCES.map((item) => (
            <Tab key={item.value} value={item.value}>
              {item.label}
            </Tab>
          ))}
        </TabList>

        <Checkbox checked={compare} onChange={(event) => setCompare(event.target.checked)}>
          <span className="type-kr-body-12-regular-lh15p6">원본 비교 UI</span>
        </Checkbox>

        {CATALOG.parts.map((group) => (
          <section key={group.part} className="flex flex-col gap-(--space-24)">
            <h2 className="type-kr-body-12-regular-lh15p6 text-text-body">{group.label}</h2>
            {group.items.map((item) => (
              <SliderRow
                key={item.code}
                label={item.label}
                min={item.min}
                max={item.max}
                step={item.step}
                value={weights[item.code] ?? item.default}
                onChange={(value) => setWeight(item.code, value)}
                minLabel="낮게"
                maxLabel="높게"
              />
            ))}
          </section>
        ))}

        <dl className="type-kr-caption-11-regular-lh14p3 grid grid-cols-2 gap-(--space-6) text-text-body">
          <dt>상태</dt>
          <dd data-testid="viewer-status">{status}</dd>
          <dt>미지원 효과</dt>
          <dd>{unsupported.length ? unsupported.join(', ') : '없음'}</dd>
          <dt>weights</dt>
          <dd className="break-all">{JSON.stringify(weights)}</dd>
        </dl>
      </aside>
    </main>
  )
}
