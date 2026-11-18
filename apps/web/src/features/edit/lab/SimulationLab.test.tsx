import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetToaster, useToastStore } from '@/shared/ui/Toast'
import { SURVEY_ENDS_AT } from '@/features/survey/schedule'
import { SURVEY_URL } from '@/features/survey/SurveyPopup'
import { clearSurveyAfterDone, markSurveyAfterDone } from '@/features/survey/SurveyAfterDone'
import { useEditStore } from '../store'
import { SAMPLE_CONTOUR_PART } from '../contourControls'
import { SAMPLE_NOSE_CATALOG } from '../noseControls'
import { WEIGHT_CONTOUR_REJECTED, WEIGHT_SHAPE_CODE } from '../weightShapeControls'
import { newEyeState, type EyeState } from '../eyes/state'
import type { EyeReviewEvidence } from '../eyes/review'
import type { NosePreviewCheck } from '@/features/viewer/types'
import { useEffect } from 'react'
import { clearTutorialRecord, EDITOR_TUTORIAL_STORAGE_KEY } from '@/features/tutorial/storage'
import { SimulationLab } from './SimulationLab'
import type { FaceProfile, MeasureProfileTrial } from './faceProfile'

// 완료는 작업실로, 알림의 이름 바꾸기는 편집실로 보낸다(-844). 주소의 `?rename=1`은 테스트마다 정한다
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: '',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
  usePathname: () => '/simulations/sim-1',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

// 코 구조 조절 스위치(-552). 손잡이 저장 흐름 테스트는 켠 상태로 돌리고, 기본값(끔)은 아래에서 따로 본다
const pointEdit = vi.hoisted(() => ({ enabled: true }))
vi.mock('../pointEdit', () => ({
  get NOSE_POINT_EDIT_ENABLED() {
    return pointEdit.enabled
  },
}))

vi.mock('@/features/viewer/FaceStage', () => ({
  FaceStage: ({
    weights,
    meshUrl,
    rigUrl,
    onUnsupportedCodes,
    onStatusChange,
    onSupportedCodes,
    onNosePreviewCheck,
    onEyeReview,
    onFaceProfile,
    onNoseHandlePreview,
    onNoseHandleCommit,
    noseHandleControls,
    pointStrokes,
    eyeEdit,
    hairUrl,
    onHairStatus,
    hairProbe,
    zoomOnlyInStage,
    holding,
  }: {
    holding?: boolean
    weights: Record<string, number>
    meshUrl: string
    rigUrl?: string
    onUnsupportedCodes?: (codes: string[]) => void
    onStatusChange?: (status: 'error' | 'ready') => void
    onSupportedCodes?: (codes: string[]) => void
    onNosePreviewCheck?: (check: NosePreviewCheck | null) => void
    onEyeReview?: (evidence: EyeReviewEvidence) => void
    onFaceProfile?: (
      data: FaceProfile,
      original: FaceProfile,
      measureTrial: MeasureProfileTrial,
    ) => void
    onNoseHandlePreview?: (changes: { id: 'bridge'; value: number }[]) => void
    onNoseHandleCommit?: () => void
    noseHandleControls?: { id: string; value: number; unavailable: boolean }[]
    pointStrokes?: { vertex: number; delta: [number, number, number] }[]
    hairUrl?: string | null
    onHairStatus?: (status: 'ready' | 'error') => void
    hairProbe?: { onStatus: (status: 'ready' | 'error') => void }
    zoomOnlyInStage?: boolean
    eyeEdit?: {
      state: EyeState
      onStatus?: (status: { ready: boolean; changed: number; message: string }) => void
    }
  }) => {
    useEffect(() => {
      onNosePreviewCheck?.(checkNosePreview)
      return () => onNosePreviewCheck?.(null)
    }, [onNosePreviewCheck])
    useEffect(() => {
      const report = () =>
        onSupportedCodes?.([
          'nose.bridge_height',
          'nose.tip_projection',
          'nose.tip_height',
          'nose.tip_rotation',
          'nose.alar_width',
          ...glbContourCodes,
        ])
      if (!supportReady) return report()
      let current = true
      void supportReady.then(() => {
        if (current) report()
      })
      return () => {
        current = false
      }
    }, [onSupportedCodes])
    useEffect(() => {
      if (glbEvidence) onEyeReview?.(glbEvidence)
    }, [onEyeReview, meshUrl])
    useEffect(() => {
      if (testProfile)
        onFaceProfile?.(testProfile, testProfile, () => ({
          ...testProfile!,
          lower: [{ ...testProfile!.lower[0], value: '0.71배' }],
        }))
    }, [onFaceProfile])
    // 첫 사용 안내 테스트만 3D 준비를 알린다(다른 테스트는 안내가 뜨지 않게)
    useEffect(() => {
      if (reportReady) onStatusChange?.('ready')
    }, [onStatusChange])
    const onEyeStatus = eyeEdit?.onStatus
    useEffect(() => {
      onEyeStatus?.({ ready: true, changed: 0, message: '' })
    }, [onEyeStatus])
    return (
      <div
        data-testid="stage"
        data-mesh={meshUrl}
        data-rig={rigUrl}
        data-points={JSON.stringify(pointStrokes ?? [])}
        data-eye={JSON.stringify(eyeEdit?.state ?? null)}
        data-hair={hairUrl ?? ''}
        data-holding={String(!!holding)}
        data-zoom-area={zoomOnlyInStage ? 'stage' : ''}
      >
        <button onClick={() => onHairStatus?.('ready')}>헤어 준비 완료</button>
        {hairProbe && <button onClick={() => hairProbe.onStatus('ready')}>헤어 맞춤 확인</button>}
        {JSON.stringify(weights)}
        <button onClick={() => onUnsupportedCodes?.(['nose.not_supported'])}>미지원 보고</button>
        <button onClick={() => onStatusChange?.('error')}>3D 오류 보고</button>
        <button onClick={() => onSupportedCodes?.(['nose.bridge_height', 'nose.alar_width'])}>
          코끝 미지원
        </button>
        {onNoseHandleCommit && noseHandleControls?.some((control) => !control.unavailable) ? (
          <>
            <button data-tutorial="point-edit">코 구조 조절</button>
            <button onClick={() => onNoseHandlePreview?.([{ id: 'bridge', value: 0.2 }])}>
              손잡이 미리보기
            </button>
            <button onClick={() => onNoseHandlePreview?.([{ id: 'bridge', value: 0 }])}>
              손잡이 원위치
            </button>
            <button onClick={() => onNoseHandleCommit()}>손잡이 저장</button>
          </>
        ) : null}
      </div>
    )
  },
  // 도구 줄의 원본 보기(누르고 있기) 버튼
  CompareHoldButton: ({ onHoldChange }: { onHoldChange: (holding: boolean) => void }) => (
    <button
      aria-label="누르고 있는 동안 원본 보기"
      onPointerDown={() => onHoldChange(true)}
      onPointerUp={() => onHoldChange(false)}
    />
  ),
}))

type Handler = (body: Record<string, unknown>) => {
  status?: number
  data?: unknown
  error?: unknown
}

const CATALOG = {
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
      ],
    },
  ],
}

/** EDIT-01이 눈 항목도 주는 경우(v2 카탈로그). 1차는 눈을 막는다 */
const CATALOG_WITH_EYE = {
  ...CATALOG,
  parts: [
    ...CATALOG.parts,
    {
      part: 'EYE',
      label: '눈',
      items: [
        {
          code: 'eye.tail_angle.right',
          subPart: 'TAIL',
          label: '눈꼬리 각도(오른쪽)',
          min: -1,
          max: 1,
          default: 0,
          step: 0.05,
        },
      ],
    },
  ],
}

const WEIGHT_CATALOG = {
  ...CATALOG,
  parts: [
    ...CATALOG.parts,
    {
      part: 'CONTOUR',
      label: '윤곽',
      items: [
        {
          code: WEIGHT_SHAPE_CODE,
          subPart: 'WEIGHT_SHAPE',
          label: '얼굴형 볼륨',
          min: -1,
          max: 1,
          default: 0,
          step: 0.01,
        },
      ],
    },
  ],
}

const COMBINED_CATALOG = {
  ...WEIGHT_CATALOG,
  parts: [
    ...CATALOG.parts,
    {
      ...SAMPLE_CONTOUR_PART,
      items: [...SAMPLE_CONTOUR_PART.items, ...WEIGHT_CATALOG.parts[1].items],
    },
  ],
}

const CHEEK = 'contour.cheek_volume'

function editState(weights: Record<string, number>, version: number, canUndo = true) {
  return {
    morphState: { schemaVersion: 'v1', weights },
    stateVersion: version,
    currentSeq: version,
    canUndo,
    canRedo: false,
  }
}

function simulation(weights: Record<string, number> = {}, version = 3) {
  return {
    simulationId: 'sim-1',
    faceModelId: 'fm-1',
    title: '2026.10.25 시안',
    ...editState(weights, version, false),
    hasChanges: false,
    lastChangeRequest: null,
  }
}

let routes: Record<string, Handler>
let glbEvidence: EyeReviewEvidence | null
let testProfile: FaceProfile | null
let reportReady = false
let supportReady: Promise<void> | null = null
let checkNosePreview: NosePreviewCheck | null = null
/** GLB에 구운 윤곽 morph target(3D가 지원한다고 알리는 윤곽 코드) */
let glbContourCodes: string[] = []

// jsdom에는 <dialog>의 showModal·close가 없다(shared/ui/Modal.test.tsx와 같은 흉내)
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function setupFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^.*\/api\/v1/, '')}`
      const handler = routes[key]
      if (!handler) throw new Error(`라우트 없음: ${key}`)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const { status = 200, data, error } = handler(body)
      return {
        ok: status < 400,
        status,
        json: async () =>
          error
            ? { success: false, data: null, error }
            : { success: true, data: data ?? null, error: null },
      }
    }),
  )
}

function calls(key: string) {
  return vi.mocked(fetch).mock.calls.filter(([input, init]) => {
    const path = new URL(String(input)).pathname.replace(/^.*\/api\/v1/, '')
    return `${init?.method ?? 'GET'} ${path}` === key
  })
}

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body))
}

beforeEach(() => {
  checkNosePreview = null
  glbEvidence = null
  testProfile = null
  reportReady = false
  supportReady = null
  glbContourCodes = []
  pointEdit.enabled = true
  routes = {
    'GET /simulations/sim-1': () => ({ data: simulation() }),
    'GET /face-models/fm-1': () => ({
      data: { faceModelId: 'fm-1', meshUrl: 'https://cdn.test/head.glb', morphSchemaVersion: 'v1' },
    }),
    'GET /morph-parameters': () => ({ data: CATALOG }),
    // 도구 줄 모델 이름(-812). 작업실과 같은 모델 목록에서 찾는다
    'GET /face-models': () => ({
      data: {
        items: [{ faceModelId: 'fm-1', title: '테스트 모델', createdAt: '2026-10-25T00:00:00Z' }],
        page: 0,
        size: 50,
        totalElements: 1,
      },
    }),
    'GET /simulations/sim-1/messages': () => ({
      data: { items: [], page: 0, size: 50, totalElements: 0 },
    }),
  }
  setupFetch()
})

afterEach(() => {
  sessionStorage.removeItem('preface:recommendation-save:sim-1')
  vi.unstubAllGlobals()
  __resetToaster()
  useEditStore.getState().reset()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  navigation.search = ''
  clearSurveyAfterDone()
  vi.useRealTimers()
})

async function openManual() {
  render(<SimulationLab simulationId="sim-1" />)
  expect(await screen.findByText('2026.10.25 시안')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '직접 조절' }))
  return screen.findByRole('slider', { name: '콧대 높이' })
}

it('추천 적용 응답 전에 다시 열어도 같은 버전의 저장을 이어간다', async () => {
  const code = 'contour.jaw_angle'
  const patch = 'PATCH /simulations/sim-1/morph-state'
  glbContourCodes = [code]
  routes['GET /morph-parameters'] = () => ({ data: COMBINED_CATALOG })
  testProfile = {
    overall: [],
    eyes: [],
    lips: [],
    side: [],
    lower: [
      { id: 'jaw-width-face-width', label: '아래턱 폭', value: '0.73배', method: '양옆을 쟀어요.' },
    ],
  }
  routes['GET /simulations/sim-1'] = () => ({
    data: {
      ...simulation(),
      capabilities: null,
      editRanges: { weights: { [code]: { min: -0.6, max: 0.8 } }, eyes: {} },
    },
  })
  routes[patch] = (body) => ({
    data: editState({ [code]: (body.changes as { value: number }[])[0].value }, 4),
  })
  routes['GET /simulations/sim-1/messages'] = () => ({
    data: {
      items: [
        {
          messageId: 'recommendation',
          role: 'ASSISTANT',
          sender: 'AI 실장님',
          content: '정면에서 아래턱 폭을 확인했어요. 사각턱을 살짝 좁히면 턱선이 모여 보여요.',
          intent: 'REPLY',
          needsClarification: false,
          options: [],
          profileSection: 'next:jawAngle:measured:-1/0.73/0.71:narrative',
          createdAt: '2026-10-25T00:00:00Z',
        },
      ],
      page: 0,
      size: 50,
      totalElements: 1,
    },
  })
  const { unmount } = render(<SimulationLab simulationId="sim-1" />)
  await screen.findByText('2026.10.25 시안')
  const openRecommendation = async () => {
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(await screen.findByLabelText('사각턱 비교 옵션'))
    fireEvent.click(screen.getByRole('button', { name: /직접 조절하기/ }))
    expect(await screen.findByText('추천 조절을 미리 보고 있어요.')).toBeVisible()
  }

  await openRecommendation()
  expect(screen.getByRole('slider', { name: '사각턱' })).toHaveValue('-0.3')
  expect(screen.getByRole('slider', { name: '사각턱' })).toHaveAccessibleDescription('추천')
  expect(screen.getByTestId('stage')).toHaveTextContent(code)
  expect(useEditStore.getState().morphState.weights).toEqual({})
  expect(calls(patch)).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(screen.getByRole('slider', { name: '사각턱' })).toHaveValue('0')
  expect(calls(patch)).toHaveLength(0)

  fireEvent.click(screen.getByRole('tab', { name: '상담' }))
  fireEvent.click(screen.getByRole('tab', { name: '직접 조절' }))
  expect(screen.getByRole('slider', { name: '사각턱' })).not.toHaveAccessibleDescription('추천')

  await openRecommendation()
  const fetchWithRoutes = vi.mocked(fetch).getMockImplementation()!
  let firstPatch = true
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (String(input).endsWith('/morph-state') && init?.method === 'PATCH' && firstPatch) {
      firstPatch = false
      return new Promise(() => {})
    }
    return fetchWithRoutes(input, init)
  })
  fireEvent.click(screen.getByRole('button', { name: '적용하기' }))
  await waitFor(() => expect(calls(patch)).toHaveLength(1))
  expect(screen.getByRole('status')).toHaveTextContent('저장 중…')
  expect(screen.queryByText(/사각턱 .*바꿨어요/)).not.toBeInTheDocument()
  unmount()
  render(<SimulationLab simulationId="sim-1" />)
  await screen.findByText('2026.10.25 시안')
  expect(calls(patch).map(bodyOf)).toEqual(
    Array(2).fill({ stateVersion: 3, changes: [{ code, value: -0.18 }] }),
  )
  expect(useEditStore.getState().morphState.weights).toMatchObject({ [code]: -0.18 })
  expect(screen.getByRole('status')).toHaveTextContent('시안에 저장했어요.')
  expect(sessionStorage.getItem('preface:recommendation-save:sim-1')).toBeNull()
})

it('재검사가 끝나면 새로고침 없이 조절을 열고 기존 편집 상태를 유지한다', async () => {
  const code = 'nose.bridge_height'
  let checked = false
  routes['GET /simulations/sim-1'] = () => ({
    data: checked
      ? {
          ...simulation({ [code]: 0.4 }, 4),
          editApprovalPending: false,
          capabilities: {
            modelVersion: 'v1',
            rigVersion: 'v1',
            engineVersion: 'v1',
            supported: { [code]: { min: -0.5, max: 0.8 } },
          },
        }
      : { ...simulation(), editApprovalPending: true, capabilities: null },
  })
  render(<SimulationLab simulationId="sim-1" />)
  expect(await screen.findByText(/조절 범위를 다시 확인하고/)).toBeInTheDocument()
  checked = true
  await waitFor(() => expect(screen.getByRole('slider', { name: '콧대 높이' })).toBeEnabled(), {
    timeout: 7000,
  })
  expect(screen.queryByText(/조절 범위를 다시 확인하고/)).not.toBeInTheDocument()
  expect(useEditStore.getState().version).toBe(3)
  expect(useEditStore.getState().morphState.weights[code]).toBeUndefined()
}, 10000)

it('코를 직접 조절할 수 있는 시안에도 첫 비교 진입점을 표시하지 않는다', async () => {
  const code = 'nose.alar_width'
  routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
  routes['GET /simulations/sim-1'] = () => ({
    data: {
      ...simulation(),
      capabilities: {
        topologyVersion: 'topology',
        rigVersion: 'rig',
        engineVersion: 'engine',
        supported: { [code]: { min: -0.1, max: 0.1 } },
      },
    },
  })
  render(<SimulationLab simulationId="sim-1" />)
  expect(await screen.findByRole('slider', { name: '콧볼 너비' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: '첫 비교 시안 보기' })).not.toBeInTheDocument()
  expect(calls('POST /simulations/sim-1/first-comparison')).toHaveLength(0)
})

it.each([true, false])(
  '첫 편집 화면에서 헤어 맞춤 확인 후에도 완료 문구는 표시하지 않고 준비되지 않은 조절만 안내한다 (%s)',
  async (allContours) => {
    reportReady = true
    glbEvidence = { review: { L: 'present', R: 'present' }, eyePartsSha256: 'c'.repeat(64) }
    const nose = Object.fromEntries(
      SAMPLE_NOSE_CATALOG.parts.flatMap(({ items }) =>
        items.map(({ code }) => [code, { min: -0.1, max: 0.1 }]),
      ),
    )
    const contourCodes = SAMPLE_CONTOUR_PART.items.map(({ code }) => code)
    glbContourCodes = [...(allContours ? contourCodes : contourCodes.slice(1)), WEIGHT_SHAPE_CODE]
    const contour = Object.fromEntries(
      [...contourCodes, WEIGHT_SHAPE_CODE].map((code) => [code, { min: -1, max: 1 }]),
    )
    const eyes = { inner: 20, outer: 20, lower: 20, upper: 20 }
    routes['GET /morph-parameters'] = () => ({
      data: {
        ...COMBINED_CATALOG,
        parts: [...SAMPLE_NOSE_CATALOG.parts, COMBINED_CATALOG.parts[1]],
      },
    })
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: {
          modelVersion: 'v1',
          rigVersion: 'v1',
          engineVersion: 'v1',
          supported: nose,
        },
        eyeReview: glbEvidence?.review,
        eyePartsSha256: glbEvidence?.eyePartsSha256,
        eyeCapabilities: { meshSha256: 'a'.repeat(64), rigSha256: 'b'.repeat(64), limits: eyes },
        editRanges: {
          weights: { ...nose, ...contour },
          eyes: Object.fromEntries(
            Object.entries(eyes).map(([code, max]) => [code, { min: 0, max }]),
          ),
        },
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    if (allContours) {
      const probe = await screen.findByRole('button', { name: '헤어 맞춤 확인' })
      fireEvent.click(probe)
      expect(screen.queryByText('편집 준비가 끝났어요.')).not.toBeInTheDocument()
      expect(screen.queryByText(/조절이 아직 준비되지 않았어요/)).not.toBeInTheDocument()
      expect(screen.getByTestId('stage')).toHaveAttribute('data-hair', '')
    } else {
      expect(await screen.findByText('윤곽 조절이 아직 준비되지 않았어요.')).toBeInTheDocument()
    }
  },
)

describe('SimulationLab — 체중 변화', () => {
  beforeEach(() => {
    routes['GET /morph-parameters'] = () => ({ data: WEIGHT_CATALOG })
    glbContourCodes = [WEIGHT_SHAPE_CODE]
  })

  it.each([true, false])(
    '3D 확인 전에는 부위를 고르고 확인 뒤 지원 여부를 표시한다 (%s)',
    async (supported) => {
      let finish = () => {}
      supportReady = new Promise<void>((resolve) => {
        finish = resolve
      })
      routes['GET /simulations/sim-1'] = () => ({
        data: { ...simulation(), capabilities: null, weightShapeSupported: true },
      })
      routes['GET /face-models/fm-1'] = () => ({
        data: {
          faceModelId: 'fm-1',
          meshUrl: 'https://cdn.test/head.glb',
          rigUrl: 'https://cdn.test/rig.json',
          morphSchemaVersion: 'v1',
        },
      })
      glbContourCodes = supported ? [WEIGHT_SHAPE_CODE] : []

      render(<SimulationLab simulationId="sim-1" />)
      expect(await screen.findByTestId('stage')).not.toHaveAttribute('data-rig')
      const rail = within(screen.getByRole('tablist', { name: '부위' }))
      for (const name of ['눈', '코', '윤곽', '체중']) {
        const tab = rail.getByRole('tab', { name })
        expect(tab).not.toHaveAttribute('aria-disabled')
        fireEvent.click(tab)
        expect(tab).toHaveAttribute('aria-selected', 'true')
      }
      // 헤어는 3D 확인과 관계없이 열 수 있다(S15P31B204-699)
      expect(rail.getByRole('tab', { name: /^헤어/ })).not.toHaveAttribute('aria-disabled')
      expect(screen.getByText('조절 항목을 불러오는 중이에요')).toBeInTheDocument()
      expect(screen.queryByRole('slider', { name: '체중 변화 감량·증량' })).toBeNull()
      expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)

      await act(async () => finish())
      if (supported) {
        expect(await screen.findByRole('slider', { name: '체중 변화 감량·증량' })).toBeEnabled()
      } else {
        expect(rail.getByRole('tab', { name: /^체중.*미지원/ })).toHaveAttribute(
          'aria-disabled',
          'true',
        )
        expect(
          screen.getByText('이 모델은 체중 변화 미리보기를 지원하지 않아요.'),
        ).toBeInTheDocument()
      }
    },
  )

  it('서버 승인과 GLB 타깃 쌍이 모두 있어야 탭을 연다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), weightShapeSupported: false },
    })
    const { unmount } = render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByRole('tab', { name: /^체중.*미지원/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    unmount()

    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), weightShapeSupported: true },
    })
    glbContourCodes = []
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByRole('tab', { name: /^체중.*미지원/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
  })

  it('체중만 반복 조절해도 즉시 미리 보고 놓을 때 저장한다', async () => {
    let saved = 0
    let version = 3
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(saved ? { [WEIGHT_SHAPE_CODE]: saved } : {}, version),
        weightShapeSupported: true,
      },
    })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      saved = (body.changes as { value: number }[])[0].value
      return { data: editState({ [WEIGHT_SHAPE_CODE]: saved }, ++version) }
    }
    const { unmount } = render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '체중' }))
    const slider = await screen.findByRole('slider', { name: '체중 변화 감량·증량' })
    await waitFor(() => expect(slider).toBeEnabled())
    expect(slider).toHaveAttribute('aria-valuetext', '원본')

    fireEvent.input(slider, { target: { value: '-0.4' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":-0.4`)
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
    act(() => slider.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(saved).toBe(-0.4))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0]).changes).toEqual([
      { code: WEIGHT_SHAPE_CODE, value: -0.4 },
    ])
    expect(slider).toHaveAttribute('aria-valuetext', '감량 방향 · 강도 40')
    // 범위 안 조절은 수치 알림을 띄우지 않는다(-852)
    expect(screen.queryByText(/바꿨어요/)).not.toBeInTheDocument()

    expect(
      screen.queryByText('슬라이더를 놓으면 조합을 검사한 뒤 저장해요.'),
    ).not.toBeInTheDocument()
    fireEvent.input(slider, { target: { value: '0.6' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":0.6`)
    fireEvent.input(slider, { target: { value: '-0.2' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":-0.2`)
    fireEvent.input(slider, { target: { value: '0.6' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":0.6`)
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1)
    act(() => slider.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(saved).toBe(0.6))
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(2)
    expect(slider).toHaveAttribute('aria-valuetext', '증량 방향 · 강도 60')
    unmount()
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":0.6`)
  })

  it('전환 전에는 기존 조절값을 보존하고 명시적으로 전환한 뒤 드래그할 수 있다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation({ 'nose.bridge_height': 0.2 }), weightShapeSupported: true },
    })
    routes['POST /simulations/sim-1/reset'] = () => ({ data: editState({}, 4) })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState(
        Object.fromEntries(
          (body.changes as { code: string; value: number }[]).map(({ code, value }) => [
            code,
            value,
          ]),
        ),
        Number(body.stateVersion) + 1,
      ),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '체중' }))
    const switchToWeight = await screen.findByRole('button', { name: '체중 변화 미리보기' })
    expect(screen.getByText('버튼을 누르면 코 조절값이 원래대로 돌아가요.')).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '체중 변화 감량·증량' })).not.toBeInTheDocument()
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.2')
    expect(calls('POST /simulations/sim-1/reset')).toHaveLength(0)
    fireEvent.click(switchToWeight)
    const weight = await screen.findByRole('slider', { name: '체중 변화 감량·증량' })
    await waitFor(() => expect(weight).toBeEnabled())
    fireEvent.input(weight, { target: { value: '-0.4' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":-0.4`)
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
    act(() => weight.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(useEditStore.getState().version).toBe(5))
    fireEvent.click(screen.getByRole('tab', { name: '코' }))
    expect(
      screen.getByText('버튼을 누르면 체중 변화 조절값이 원래대로 돌아가요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":-0.4`)
    fireEvent.click(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' }))
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeEnabled()
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[1])).toEqual({
      stateVersion: 5,
      changes: [{ code: WEIGHT_SHAPE_CODE, value: 0 }],
    })
  })

  it('코 자동 저장을 기다리는 동안 다른 부위의 미리보기와 후속 저장을 유지한다', async () => {
    glbContourCodes = [WEIGHT_SHAPE_CODE, CHEEK]
    routes['GET /morph-parameters'] = () => ({ data: COMBINED_CATALOG })
    const saved: Record<string, number> = {}
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      for (const { code, value } of body.changes as { code: string; value: number }[])
        saved[code] = value
      return { data: editState({ ...saved }, Number(body.stateVersion) + 1) }
    }
    const respond = vi.mocked(fetch).getMockImplementation()!
    let finishSave = () => {}
    const slowSave = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await respond(input, init)
      if (init?.method === 'PATCH' && calls('PATCH /simulations/sim-1/morph-state').length === 1)
        await slowSave
      return response
    })
    render(<SimulationLab simulationId="sim-1" />)
    const nose = await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.input(nose, { target: { value: '0.2' } })
    act(() => nose.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    fireEvent.click(screen.getByRole('tab', { name: '윤곽' }))
    const cheek = await screen.findByRole('slider', { name: '볼살' })
    expect(cheek).toBeEnabled()
    fireEvent.input(cheek, { target: { value: '0.2' } })
    fireEvent.input(cheek, { target: { value: '0.4' } })
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${CHEEK}":0.4`)
    act(() => cheek.dispatchEvent(new Event('change', { bubbles: true })))
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1)
    await act(async () => finishSave())
    await waitFor(() => expect(useEditStore.getState().version).toBe(5))
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${CHEEK}":0.4`)
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[1]).stateVersion).toBe(4)
  })

  it('다른 시안으로 이동하면 늦게 도착한 복합 이력 응답을 반영하지 않는다', async () => {
    glbContourCodes = [WEIGHT_SHAPE_CODE, CHEEK]
    routes['GET /morph-parameters'] = () => ({ data: COMBINED_CATALOG })
    const initial = { [WEIGHT_SHAPE_CODE]: 0.4 }
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(initial), weightShapeSupported: true, canRedo: true },
    })
    routes['GET /simulations/sim-2'] = () => ({
      data: { ...simulation({}, 9), simulationId: 'sim-2' },
    })
    routes['GET /simulations/sim-2/messages'] = routes['GET /simulations/sim-1/messages']
    routes['POST /simulations/sim-1/redo'] = () => ({
      data: editState({ ...initial, [CHEEK]: 0.2 }, 4),
    })
    const respond = vi.mocked(fetch).getMockImplementation()!
    let finishRedo = () => {}
    const redo = new Promise<void>((resolve) => {
      finishRedo = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await respond(input, init)
      if (String(input).endsWith('/redo')) await redo
      return response
    })

    const view = render(<SimulationLab simulationId="sim-1" />)
    const redoButton = await screen.findByRole('button', { name: '앞으로 가기' })
    await waitFor(() => expect(redoButton).toBeEnabled())
    fireEvent.click(redoButton)
    await waitFor(() => expect(calls('POST /simulations/sim-1/redo')).toHaveLength(1))
    view.rerender(<SimulationLab simulationId="sim-2" />)
    await waitFor(() => expect(useEditStore.getState().simulationId).toBe('sim-2'))
    await act(async () => finishRedo())
    expect(useEditStore.getState()).toMatchObject({
      simulationId: 'sim-2',
      version: 9,
      morphState: { weights: {} },
    })
    expect(screen.getByTestId('stage')).not.toHaveTextContent(CHEEK)
  })

  it('서버 이력의 undo·redo가 얼굴형 값을 다시 표시한다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation({ [WEIGHT_SHAPE_CODE]: -0.5 }),
        canUndo: true,
        weightShapeSupported: true,
      },
    })
    routes['POST /simulations/sim-1/undo'] = () => ({
      data: { ...editState({}, 4, false), canRedo: true },
    })
    routes['POST /simulations/sim-1/redo'] = () => ({
      data: editState({ [WEIGHT_SHAPE_CODE]: -0.5 }, 5),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(calls('POST /simulations/sim-1/undo')).toHaveLength(1))
    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    expect(await screen.findByText('체중 변화 미리보기를 원본으로 되돌렸어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '앞으로 가기' }))
    expect(
      await screen.findByText('체중 변화 미리보기를 감량 방향으로 다시 바꿨어요'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":-0.5`)
  })

  it('눈을 실시간으로 보여 주고 저장 거절 시 마지막 저장값으로 복원한다', async () => {
    glbEvidence = { review: { L: 'absent', R: 'absent' }, eyePartsSha256: 'c'.repeat(64) }
    const weights = {}
    let savedEyes = newEyeState()
    let version = 3
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(weights, version),
        morphState: { schemaVersion: 'v1', weights, eyeEdit: savedEyes },
        weightShapeSupported: true,
        eyeReview: { L: 'absent', R: 'absent' },
        eyePartsSha256: 'c'.repeat(64),
        eyeCapabilities: {
          meshSha256: 'a'.repeat(64),
          rigSha256: 'b'.repeat(64),
          limits: { inner: 30, outer: 30, upper: 30, lower: 30, 'inout:height': 40 },
        },
      },
    })
    routes['PATCH /simulations/sim-1/eye-state'] = (body) => {
      savedEyes = body.eyeEdit as EyeState
      version += 1
      return {
        data: {
          ...editState(weights, version),
          morphState: { schemaVersion: 'v1', weights, eyeEdit: savedEyes },
        },
      }
    }
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(screen.getByRole('tab', { name: '눈' })).toBeEnabled())
    fireEvent.click(screen.getByRole('tab', { name: '눈' }))
    const eye = await screen.findByRole('slider', { name: '앞트임' })
    expect(eye).toBeEnabled()
    const shownInner = () =>
      JSON.parse(screen.getByTestId('stage').getAttribute('data-eye') ?? 'null').L.values.inner
    fireEvent.input(eye, { target: { value: '15' } })
    expect(shownInner()).toBe(15)
    fireEvent.input(eye, { target: { value: '10' } })
    expect(shownInner()).toBe(10)
    expect(calls('PATCH /simulations/sim-1/eye-state')).toHaveLength(0)
    fireEvent.input(eye, { target: { value: '15' } })
    act(() => eye.dispatchEvent(new Event('change', { bubbles: true })))
    await waitFor(() => expect(useEditStore.getState().morphState.eyeEdit?.L.values.inner).toBe(15))
    expect(calls('PATCH /simulations/sim-1/eye-state')).toHaveLength(1)

    routes['PATCH /simulations/sim-1/eye-state'] = () => ({
      status: 400,
      error: { code: 'EDIT_001', message: '저장하지 못했어요.', details: [] },
    })
    await waitFor(() => expect(eye).toBeEnabled())
    fireEvent.input(eye, { target: { value: '20' } })
    expect(shownInner()).toBe(20)
    act(() => eye.dispatchEvent(new Event('change', { bubbles: true })))
    expect(await screen.findByText('저장하지 못했어요.')).toBeInTheDocument()
    await waitFor(() => expect(shownInner()).toBe(15))
    expect(eye).toHaveValue('15')
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
  })
})

describe('SimulationLab — 헤어', () => {
  beforeEach(() => {
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
  })

  it('헤어 탭에서 리프컷 카드를 누르면 3D에 씌우고, 다시 누르면 벗기며, 서버에 저장하지 않는다', async () => {
    await openManual()
    const tab = screen.getByRole('tab', { name: /^헤어/ })
    // 탭 이름 옆 `베타`(cc-note)는 뗐다(S15P31B204-770에서 붙임, S15P31B204-838에서 뗌)
    expect(tab).toHaveTextContent(/^헤어$/)
    expect(tab.querySelector('.cc-note')).toBeNull()
    fireEvent.click(tab)
    const bob = await screen.findByRole('button', { name: '리프컷' })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-hair', '')

    fireEvent.click(bob)
    expect(screen.getByTestId('stage').getAttribute('data-hair')).toMatch(/\/hair\/male-leaf\.glb$/)
    expect(screen.getByText('헤어를 불러오는 중이에요.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '헤어 준비 완료' }))
    expect(screen.queryByText('헤어를 불러오는 중이에요.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '리프컷' }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-hair', '')
    // 헤어는 되돌리기 이력·서버 저장 대상이 아니다(FN-HAIR-01 수용 3)
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
  })

  it('도구 줄 원본 보기를 누르고 있는 동안 3D에 원본 보기를 알리고, 떼면 고른 헤어가 그대로 남는다(S15P31B204-839)', async () => {
    await openManual()
    fireEvent.click(screen.getByRole('tab', { name: /^헤어/ }))
    fireEvent.click(await screen.findByRole('button', { name: '리프컷' }))
    const stage = screen.getByTestId('stage')
    const hair = stage.getAttribute('data-hair')
    expect(hair).toMatch(/\/hair\/male-leaf\.glb$/)

    // 헤어를 숨기는 일은 3D 무대(FaceStage)가 holding을 보고 한다. 고른 헤어는 바꾸지 않는다
    const hold = screen.getByRole('button', { name: '누르고 있는 동안 원본 보기' })
    fireEvent.pointerDown(hold)
    expect(stage).toHaveAttribute('data-holding', 'true')
    expect(stage).toHaveAttribute('data-hair', hair!)
    fireEvent.pointerUp(hold)
    expect(stage).toHaveAttribute('data-holding', 'false')
    expect(stage).toHaveAttribute('data-hair', hair!)
  })
})

describe('SimulationLab — 원본 사진 탭 (S15P31B204-770)', () => {
  beforeEach(() => {
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
  })

  it('정면 사진이 있으면 방식 탭에 `원본 사진`을 더하고, 누르면 카드에 사진을 채운다(툴바 버튼은 없다)', async () => {
    routes['GET /face-models/fm-1/front-photo'] = () => ({
      data: {
        url: 'https://s3.test/front.jpg',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    })
    await openManual()
    const rail = within(screen.getByRole('tablist', { name: '편집 방식' }))
    const photoTab = await rail.findByRole('tab', { name: '원본 사진' })
    expect(rail.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '직접 조절',
      '상담',
      '원본 사진',
    ])
    expect(screen.queryByRole('button', { name: '내 정면 사진 보기' })).toBeNull()
    expect(screen.queryByRole('img', { name: '촬영한 내 정면 사진' })).toBeNull()

    fireEvent.click(photoTab)
    const photo = screen.getByRole('img', { name: '촬영한 내 정면 사진' })
    expect(photo).toHaveAttribute('src', 'https://s3.test/front.jpg')
    expect(photo).toHaveAttribute('data-clarity-mask', 'True')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-mode', 'photo')
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).toBeNull()

    fireEvent.click(rail.getByRole('tab', { name: '직접 조절' }))
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '촬영한 내 정면 사진' })).toBeNull()
  })

  it('정면 사진이 없는 3D(404)는 두 탭 그대로다', async () => {
    routes['GET /face-models/fm-1/front-photo'] = () => ({
      status: 404,
      error: { code: 'COMMON_002', message: '없음', details: [] },
    })
    await openManual()
    await waitFor(() => expect(calls('GET /face-models/fm-1/front-photo')).toHaveLength(1))
    const rail = within(screen.getByRole('tablist', { name: '편집 방식' }))
    expect(rail.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['직접 조절', '상담'])
  })
})

describe('SimulationLab — 코끝 통합 조절', () => {
  beforeEach(() => {
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
  })

  it('모델 승인 정보가 없으면 코 슬라이더를 비활성화한다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: { ...simulation(), capabilities: null } })
    const slider = await openManual()
    expect(slider).toBeDisabled()
    expect(
      screen.getByText('이 3D는 코 편집 검사를 준비 중이에요. 얼굴은 바뀌지 않아요.'),
    ).toBeInTheDocument()
  })

  it('윤곽은 코 승인과 별개로 공통 범위와 GLB 타깃이 모두 있으면 열고 저장한다', async () => {
    routes['GET /morph-parameters'] = () => ({
      data: { ...CATALOG, parts: [...CATALOG.parts, SAMPLE_CONTOUR_PART] },
    })
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: null,
        editRanges: { weights: { 'contour.jaw_angle': { min: -0.6, max: 0.8 } }, eyes: {} },
      },
    })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'contour.jaw_angle': (body.changes as { value: number }[])[0].value }, 4),
    })
    glbContourCodes = ['contour.jaw_angle', 'contour.cheekbone']
    await openManual()
    fireEvent.click(screen.getByRole('tab', { name: '윤곽' }))
    const jaw = await screen.findByRole('slider', { name: '사각턱' })
    await waitFor(() => expect(jaw).toBeEnabled())
    // 타깃만 있고 서버 범위가 없는 윤곽 코드는 잠긴다
    expect(screen.getByRole('slider', { name: '광대 크기' })).toBeDisabled()

    fireEvent.input(jaw, { target: { value: '-0.4' } })
    act(() => {
      jaw.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0]).changes).toEqual([
      { code: 'contour.jaw_angle', value: -0.24 },
    ])
  })

  it('승인된 효과와 모델별 범위만 조절한다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: {
          modelVersion: 'topology',
          rigVersion: 'rig',
          engineVersion: 'engine',
          supported: { 'nose.bridge_height': { min: -0.2, max: 0.3 } },
        },
      },
    })
    const slider = await openManual()
    await waitFor(() => expect(slider).toBeEnabled())
    expect(slider).toHaveAttribute('min', '-1')
    expect(slider).toHaveAttribute('max', '1')
    expect(slider).toHaveValue('0')
    expect(screen.getByRole('slider', { name: '코끝 앞뒤' })).toBeDisabled()
  })

  it('화면 +100%는 승인된 모델의 실제 최대값으로 한 번 저장한다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: {
          modelVersion: 'topology',
          rigVersion: 'rig',
          engineVersion: 'engine',
          supported: { 'nose.bridge_height': { min: -0.2, max: 0.3 } },
        },
      },
    })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
    })
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '1' } })
    fireEvent.change(slider, { target: { value: '1' } })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0]).changes).toEqual([
      { code: 'nose.bridge_height', value: 0.3 },
    ])
    expect(slider).toHaveAttribute('aria-valuetext', '+100%')
  })

  it('코 구조 손잡이는 기존 점 이력을 보존하고 모프값만 한 번 저장한다', async () => {
    const previousStroke = { vertex: 3, delta: [0, 0.001, 0] }
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        morphState: { schemaVersion: 'v1', weights: {}, pointStrokes: [previousStroke] },
        capabilities: {
          modelVersion: 'topology',
          rigVersion: 'rig',
          engineVersion: 'engine',
          supported: { 'nose.bridge_height': { min: -1, max: 1 } },
        },
      },
    })
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: 'https://cdn.test/head.glb',
        rigUrl: 'https://cdn.test/rig.json',
        morphSchemaVersion: 'v1',
      },
    })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: {
        ...editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
        morphState: {
          schemaVersion: 'v1',
          weights: { 'nose.bridge_height': (body.changes as { value: number }[])[0].value },
          pointStrokes: [previousStroke],
        },
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    const stage = await screen.findByTestId('stage')
    const preview = await screen.findByRole('button', { name: '손잡이 미리보기' })
    fireEvent.click(preview)
    expect(stage).toHaveAttribute('data-points', JSON.stringify([previousStroke]))
    expect(stage).toHaveTextContent('"nose.bridge_height":0.2')
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '손잡이 저장' }))
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0]).changes).toEqual([
      { code: 'nose.bridge_height', value: 0.2 },
    ])
    expect(calls('PATCH /simulations/sim-1/point-strokes')).toHaveLength(0)
    expect(stage).toHaveAttribute('data-points', JSON.stringify([previousStroke]))
  })

  it('손잡이를 원위치로 되돌린 뒤 놓으면 빈 변경을 저장하지 않는다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: {
          modelVersion: 'topology',
          rigVersion: 'rig',
          engineVersion: 'engine',
          supported: { 'nose.bridge_height': { min: -1, max: 1 } },
        },
      },
    })
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: 'https://cdn.test/head.glb',
        rigUrl: 'https://cdn.test/rig.json',
        morphSchemaVersion: 'v1',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: '손잡이 미리보기' }))
    fireEvent.click(screen.getByRole('button', { name: '손잡이 원위치' }))
    fireEvent.click(screen.getByRole('button', { name: '손잡이 저장' }))
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
    expect(useEditStore.getState().isDirty).toBe(false)
  })

  it('내림의 두 값을 한 요청으로 저장한다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState(
        Object.fromEntries(
          (body.changes as { code: string; value: number }[]).map((c) => [c.code, c.value]),
        ),
        4,
      ),
    })
    await openManual()
    const slider = screen.getByRole('slider', { name: '코끝 위아래' })
    await waitFor(() => expect(slider).toBeEnabled())
    fireEvent.input(slider, { target: { value: '0.5' } })
    fireEvent.change(slider, { target: { value: '0.5' } })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0]).changes).toEqual([
      { code: 'nose.tip_height', value: -0.3 },
      { code: 'nose.tip_rotation', value: -0.2 },
    ])
  })

  it('저장 실패 시 두 미리보기 값을 함께 원래 값으로 돌린다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: '저장 실패' },
    })
    await openManual()
    const slider = screen.getByRole('slider', { name: '코끝 위아래' })
    await waitFor(() => expect(slider).toBeEnabled())
    fireEvent.input(slider, { target: { value: '0.5' } })
    fireEvent.change(slider, { target: { value: '0.5' } })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights['nose.tip_height'] ?? 0).toBe(0),
    )
    expect(useEditStore.getState().morphState.weights['nose.tip_rotation'] ?? 0).toBe(0)
    expect(screen.getByText('저장하지 못했어요')).toBeInTheDocument()
    expect(screen.queryByText('자동 저장됨')).not.toBeInTheDocument()
  })

  it('기존 개별 값은 그대로 보여주고, 미지원 모델에서는 통합 조절을 막는다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: simulation({ 'nose.tip_height': 0.6, 'nose.tip_rotation': 0.1 }),
    })
    await openManual()
    expect(screen.getByText('개별 값')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights['nose.tip_rotation']).toBe(0.1)
    fireEvent.click(screen.getByText('코끝 미지원'))
    expect(screen.getByRole('slider', { name: '코끝 위아래' })).toBeDisabled()
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)
  })
})

describe('SimulationLab — 회원 눈 저장', () => {
  it('모델 판정과 승인 한계가 있으면 양쪽 앞트임을 미리 보고 한 번 저장한다', async () => {
    const initial = newEyeState()
    glbEvidence = { review: { L: 'absent', R: 'absent' }, eyePartsSha256: 'c'.repeat(64) }
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        morphState: { schemaVersion: 'v1', weights: {}, eyeEdit: null },
        eyeReview: { L: 'absent', R: 'absent' },
        eyePartsSha256: 'c'.repeat(64),
        eyeCapabilities: {
          meshSha256: 'a'.repeat(64),
          rigSha256: 'b'.repeat(64),
          limits: { inner: 30, outer: 30, upper: 30, lower: 30, 'inout:height': 40 },
        },
      },
    })
    routes['PATCH /simulations/sim-1/eye-state'] = (body) => ({
      data: {
        ...editState({}, 4),
        morphState: { schemaVersion: 'v1', weights: {}, eyeEdit: body.eyeEdit },
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '눈' }))
    const slider = await screen.findByRole('slider', { name: '앞트임' })
    await waitFor(() => expect(slider).toBeEnabled())
    fireEvent.input(slider, { target: { value: '15' } })
    expect(
      JSON.parse(screen.getByTestId('stage').getAttribute('data-eye') ?? 'null').L.values.inner,
    ).toBe(15)
    fireEvent.change(slider, { target: { value: '15' } })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/eye-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/eye-state')[0])).toEqual({
      stateVersion: 3,
      eyeEdit: {
        L: { ...initial.L, values: { ...initial.L.values, inner: 15 } },
        R: { ...initial.R, values: { ...initial.R.values, inner: 15 } },
      },
    })
  })

  it.each([
    ['GLB 판정 없음', null],
    ['좌우 판정 불일치', { review: { L: 'present', R: 'absent' }, eyePartsSha256: 'c'.repeat(64) }],
    ['판정 해시 불일치', { review: { L: 'absent', R: 'absent' }, eyePartsSha256: 'd'.repeat(64) }],
  ] as const)('%s이면 회원 눈 패널을 열지 않는다', async (_label, evidence) => {
    glbEvidence = evidence
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        eyeReview: { L: 'absent', R: 'absent' },
        eyePartsSha256: 'c'.repeat(64),
        eyeCapabilities: { limits: { inner: 30 } },
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: /눈/ }))
    expect(screen.queryByRole('slider', { name: '앞트임' })).not.toBeInTheDocument()
  })
})

describe('SimulationLab — 불러오기', () => {
  it('EDIT-03으로 가중치를 열고 HIS-02 메시를 3D에 넘긴다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ 'nose.bridge_height': 0.2 }) })
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: 'https://cdn.test/head.glb',
        rigUrl: 'https://cdn.test/rig.json',
        morphSchemaVersion: 'v1',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    const stage = await screen.findByTestId('stage')
    expect(stage).toHaveAttribute('data-mesh', 'https://cdn.test/head.glb')
    expect(stage).toHaveAttribute('data-rig', 'https://cdn.test/rig.json')
    // 휠 확대는 3D 무대 칸 안에서만 받는다(-788)
    expect(stage).toHaveAttribute('data-zoom-area', 'stage')
    expect(stage).toHaveTextContent('"nose.bridge_height":0.2')
  })

  it('서명된 메시·리그 URL이 실패하면 모델 상세를 다시 읽어 새 URL을 받는다', async () => {
    let issued = 0
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: `https://cdn.test/head-${++issued}.glb`,
        rigUrl: `https://cdn.test/rig-${issued}.json`,
        morphSchemaVersion: 'v1',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    const stage = await screen.findByTestId('stage')
    expect(stage).toHaveAttribute('data-rig', 'https://cdn.test/rig-1.json')
    fireEvent.click(screen.getByRole('button', { name: '3D 오류 보고' }))
    await waitFor(() => expect(stage).toHaveAttribute('data-rig', 'https://cdn.test/rig-2.json'))
    expect(calls('GET /face-models/fm-1')).toHaveLength(2)
  })

  it('지원하지 않는 저장 효과는 After를 성공처럼 보여 주지 않는다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByTestId('stage')
    fireEvent.click(screen.getByRole('button', { name: '미지원 보고' }))
    expect(screen.getByRole('alert')).toHaveTextContent('얼굴 변경을 확인할 수 없습니다')
  })

  it('없는 시안(404)은 없음 화면', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      status: 404,
      error: { code: 'COMMON_002', message: '없음', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByText('시안을 찾을 수 없어요')).toBeInTheDocument()
  })
})

function release(slider: HTMLElement) {
  act(() => {
    slider.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('SimulationLab — 직접 조절·자동 저장', () => {
  it('위험한 코 미리보기는 건너뛰고 마지막으로 그린 값만 저장한다', async () => {
    checkNosePreview = (candidate) => (candidate['nose.bridge_height'] ?? 0) <= 0.4
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      data: editState({ 'nose.bridge_height': 0.24 }, 4),
    })
    const slider = await openManual()
    const stage = screen.getByTestId('stage')
    const requests = () => calls('PATCH /simulations/sim-1/morph-state')

    fireEvent.input(slider, { target: { value: '0.8' } })
    release(slider)
    expect(slider).toHaveValue('0')
    expect(requests()).toHaveLength(0)

    fireEvent.input(slider, { target: { value: '0.2' } })
    expect(stage).toHaveTextContent('"nose.bridge_height":0.16')
    fireEvent.input(slider, { target: { value: '0.8' } })
    expect(slider).toHaveAttribute('aria-valuetext', '+20%')
    expect(stage).toHaveTextContent('"nose.bridge_height":0.16')
    expect(screen.getByText(/안전한 마지막 값/)).toBeInTheDocument()

    fireEvent.input(slider, { target: { value: '0.3' } })
    expect(stage).toHaveTextContent('"nose.bridge_height":0.24')
    expect(screen.queryByText(/안전한 마지막 값/)).not.toBeInTheDocument()
    fireEvent.input(slider, { target: { value: '0.9' } })
    release(slider)
    await waitFor(() => expect(requests()).toHaveLength(1))
    expect(bodyOf(requests()[0]).changes).toEqual([{ code: 'nose.bridge_height', value: 0.24 }])
  })
  it('움직이는 동안은 저장하지 않고, 놓을 때 EDIT-04를 한 번 부른다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
    })
    const slider = await openManual()

    // 드래그 중에는 input만 온다. 놓을 때 change가 한 번 온다
    fireEvent.input(slider, { target: { value: '0.1' } })
    fireEvent.input(slider, { target: { value: '0.2' } })
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.16')
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(0)

    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[0])).toEqual({
      stateVersion: 3,
      changes: [{ code: 'nose.bridge_height', value: 0.16 }],
    })
    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled()
    expect(screen.getByText('자동 저장됨')).toBeInTheDocument()
  })

  it('서버가 확정한 코 값과 합치면 안전하지 않은 미리보기는 저장하지 않는다', async () => {
    checkNosePreview = (candidate) =>
      !candidate['nose.alar_width'] || (candidate['nose.bridge_height'] ?? 0) >= 0.15
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      data: editState({ 'nose.bridge_height': 0.1 }, 4),
    })
    const slider = await openManual()
    const alar = screen.getByRole('slider', { name: '콧볼 너비' })
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    fireEvent.input(alar, { target: { value: '0.2' } })
    expect(alar).toHaveAttribute('aria-valuetext', '+20%')

    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    expect(alar).toHaveValue('0')
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.1')
    release(alar)
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1)
  })

  // 서버 코 검사기가 콧볼 저장을 거절하면 EDIT-03을 다시 읽어 콧볼만 원래 값으로 돌아간다. 뒤에 줄 선 콧대는 남고,
  // 일반 오류 문구 대신 돌린 항목을 짚는 알림 하나만 뜬다(S15P31B204-852)
  it.each([
    ['EDIT_032', '콧볼 너비는 지금 코 모양에서 적용할 수 없어 원래 값으로 돌렸어요'],
    ['EDIT_031', '코 검사가 아직 준비되지 않아 콧볼 너비를 원래 값으로 돌렸어요'],
  ])(
    '코 검사기가 콧볼 저장을 거절하면(%s) 콧볼만 돌리고 그 항목을 알린다',
    async (code, message) => {
      const serverMessage = '이 조절은 코 모양을 안전하게 유지할 수 없어 적용하지 않았어요.'
      routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
      routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
        const changes = body.changes as { code: string; value: number }[]
        return changes.some((change) => change.code === 'nose.alar_width')
          ? { status: 409, error: { code, message: serverMessage, details: [] } }
          : { data: editState(Object.fromEntries(changes.map((c) => [c.code, c.value])), 4) }
      }
      const bridge = await openManual()
      const alar = screen.getByRole('slider', { name: '콧볼 너비' })
      fireEvent.input(alar, { target: { value: '0.2' } })
      release(alar)
      fireEvent.input(bridge, { target: { value: '0.2' } })
      release(bridge)

      await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(2))
      await waitFor(() => expect(useEditStore.getState().version).toBe(4))
      const saved = bodyOf(calls('PATCH /simulations/sim-1/morph-state')[1]).changes
      expect(saved).toEqual([{ code: 'nose.bridge_height', value: expect.any(Number) }])
      expect(useEditStore.getState().morphState.weights).toEqual({
        'nose.bridge_height': saved[0].value,
      })
      expect(alar).toHaveValue('0')
      expect(bridge).not.toHaveValue('0')
      expect(screen.getAllByText(message)).toHaveLength(1)
      expect(screen.queryByText(serverMessage)).not.toBeInTheDocument()
    },
  )

  it('슬라이더를 떠날 때 change가 없어도 미리보기를 저장한다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
    })
    const slider = await openManual()

    fireEvent.input(slider, { target: { value: '0.01' } })
    fireEvent.blur(slider)

    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    await waitFor(() => expect(useEditStore.getState().isDirty).toBe(false))
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.008)
  })

  it('눈 승인 정보가 없는 모델은 눈 미지원을 표시하고 예전 눈 값을 3D에 넘기지 않는다', async () => {
    routes['GET /morph-parameters'] = () => ({ data: CATALOG_WITH_EYE })
    routes['GET /simulations/sim-1'] = () => ({
      data: simulation({ 'nose.bridge_height': 0.2, 'eye.tail_angle.right': 0.4 }),
    })
    await openManual()
    const eyeTab = await screen.findByRole('tab', { name: /눈\s*미지원/ })
    expect(eyeTab).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(eyeTab)
    expect(screen.queryByRole('slider', { name: /눈꼬리/ })).not.toBeInTheDocument()
    // 눌러도 탭은 그대로이고 아직 지원하지 않는다고 알린다. 여러 번 눌러도 한 번만 뜬다
    const message = '이 모델에서 눈 조절에 필요한 형상 정보가 확인되지 않았어요.'
    expect(await screen.findByText(message)).toBeInTheDocument()
    fireEvent.click(eyeTab)
    expect(screen.getAllByText(message)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')

    const stage = screen.getByTestId('stage')
    expect(stage).toHaveTextContent('"nose.bridge_height":0.2')
    expect(stage).not.toHaveTextContent('eye.')
    // 저장된 값은 건드리지 않는다
    expect(useEditStore.getState().morphState.weights).toHaveProperty('eye.tail_angle.right', 0.4)
    // 상태 줄은 보이는 코 항목만 센다
    expect(screen.getByRole('button', { name: '처음으로' })).toBeEnabled()
  })

  it('예전 눈 값만 남은 시안은 0개 항목이고 처음으로를 끈다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: simulation({ 'eye.tail_angle.right': 0.4 }),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    expect(screen.getByRole('button', { name: '처음으로' })).toBeDisabled()
    expect(useEditStore.getState().morphState.weights).toHaveProperty('eye.tail_angle.right', 0.4)
  })

  it('버전 충돌(EDIT_002)이면 EDIT-03을 다시 읽고 알린다', async () => {
    let reads = 0
    routes['GET /simulations/sim-1'] = () => ({
      data: ++reads === 1 ? simulation() : simulation({ 'nose.bridge_height': 0.1 }, 4),
    })
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      status: 409,
      error: { code: 'EDIT_002', message: '최신 상태로 불러왔어요.', details: [] },
    })
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.3' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    expect(await screen.findByText('최신 상태로 불러왔어요.')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.1 })
    expect(screen.getByText('변경은 자동 저장돼요')).toBeInTheDocument()
    expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument()
  })

  it('버전 충돌 뒤 최신 상태 재조회도 실패하면 저장 오류를 남긴다', async () => {
    let reads = 0
    routes['GET /simulations/sim-1'] = () =>
      ++reads === 1
        ? { data: simulation() }
        : { status: 503, error: { code: 'COMMON_003', message: '잠시 후 다시 시도해 주세요.' } }
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      status: 409,
      error: { code: 'EDIT_002', message: '최신 상태로 불러왔어요.', details: [] },
    })
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.3' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    expect(screen.getByText('저장하지 못했어요')).toBeInTheDocument()
  })
})

describe('SimulationLab — 조절 요약·변경내역 순서', () => {
  function patchEchoes() {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      return { data: editState({ [change.code]: change.value }, 4) }
    }
  }

  /** 볼살 슬라이더. 윤곽은 서버가 화면과 같은 범위로만 자르므로 한계면 손을 떼자마자 알린다(-839·-852) */
  async function openCheek() {
    glbContourCodes = [CHEEK]
    routes['GET /morph-parameters'] = () => ({ data: COMBINED_CATALOG })
    await openManual()
    fireEvent.click(screen.getByRole('tab', { name: '윤곽' }))
    const cheek = await screen.findByRole('slider', { name: '볼살' })
    await waitFor(() => expect(cheek).toBeEnabled())
    return cheek
  }

  /** 저장(PATCH) 응답을 붙잡아 두는 문. 부르면 흘려보낸다 */
  function holdSave() {
    const respond = vi.mocked(fetch).getMockImplementation()!
    let answer = () => {}
    const gate = new Promise<void>((resolve) => {
      answer = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await respond(input, init)
      if (String(input).endsWith('/morph-state')) await gate
      return response
    })
    return () => act(async () => answer())
  }

  function watchToasts() {
    const seen: string[] = []
    const unsubscribe = useToastStore.subscribe((state) => {
      for (const { message } of state.items) if (seen.at(-1) !== message) seen.push(message)
    })
    return { seen, unsubscribe }
  }

  it('범위 안에서 슬라이더를 놓아 저장돼도 수치 알림은 띄우지 않는다(-852)', async () => {
    patchEchoes()
    const slider = await openManual()
    const { seen, unsubscribe } = watchToasts()
    fireEvent.input(slider, { target: { value: '0.1' } })
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    unsubscribe()
    expect(seen).toEqual([])
    expect(slider).toHaveAttribute('aria-valuetext', '+20%')
  })

  it('윤곽도 범위 안이면 손을 뗄 때도 응답 뒤에도 알리지 않는다(-852)', async () => {
    patchEchoes()
    const slider = await openCheek()
    const answer = holdSave()
    const { seen, unsubscribe } = watchToasts()
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    expect(useEditStore.getState().version).toBe(3)

    await answer()
    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    unsubscribe()
    expect(seen).toEqual([])
  })

  it('서버가 줄였으면 바꿨다는 알림 없이 그 값까지만 바꿀 수 있다고만 알린다(-852)', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      return { data: { ...editState({ [change.code]: change.value / 2 }, 4), clamped: true } }
    }
    const slider = await openManual()
    const answer = holdSave()
    const { seen, unsubscribe } = watchToasts()
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    expect(screen.queryByText(/바꿨어요/)).not.toBeInTheDocument()

    await answer()
    expect(await screen.findByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).toBeInTheDocument()
    unsubscribe()
    expect(seen).toEqual(['콧대 높이는 +10%까지만 바꿀 수 있어요'])
    expect(slider).toHaveAttribute('aria-valuetext', '+10%')
  })

  it('서버가 하나도 바꾸지 않았으면 바꿨다는 알림 없이 더 바꿀 수 없다고만 알리고, 슬라이더는 저장값으로 돌아간다(-852)', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({ data: editState({}, 4) })
    const slider = await openManual()
    const answer = holdSave()
    const { seen, unsubscribe } = watchToasts()
    fireEvent.input(slider, { target: { value: '0.25' } })
    release(slider)
    expect(screen.queryByText(/바꿨어요/)).not.toBeInTheDocument()

    await answer()
    expect(await screen.findByText('콧대 높이는 이 얼굴에서 더 바꿀 수 없어요')).toBeInTheDocument()
    unsubscribe()
    expect(seen).toEqual(['콧대 높이는 이 얼굴에서 더 바꿀 수 없어요'])
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBeUndefined()
    expect(slider).toHaveAttribute('aria-valuetext', '0%')
  })

  it('잇달아 한계에 걸리면 앞 한계 알림을 걷고 마지막 것만 남긴다', async () => {
    let version = 3
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      version += 1
      return {
        data: { ...editState({ [change.code]: change.value / 2 }, version), clamped: true },
      }
    }
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    expect(await screen.findByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).toBeInTheDocument()

    fireEvent.input(slider, { target: { value: '0.4' } })
    release(slider)
    expect(await screen.findByText('콧대 높이는 +20%까지만 바꿀 수 있어요')).toBeInTheDocument()
    expect(screen.queryByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).not.toBeInTheDocument()
  })

  it('저장에 실패하면 실패 알림 하나만 띄운다(-839)', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      status: 409,
      error: { code: 'EDIT_002', message: '최신 상태로 불러왔어요.', details: [] },
    })
    const slider = await openCheek()
    fireEvent.input(slider, { target: { value: '0.3' } })
    release(slider)
    expect(await screen.findByText('최신 상태로 불러왔어요.')).toBeInTheDocument()
    expect(screen.queryByText(/바꿨어요/)).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-toaster] [role="status"] > div')).toHaveLength(1)
  })

  it('서버가 이 얼굴의 한계로 줄였으면 그 값까지만 바꿀 수 있다고 알리고, 슬라이더는 그 값으로 한 번 옮긴다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      return { data: { ...editState({ [change.code]: change.value / 2 }, 4), clamped: true } }
    }
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    expect(await screen.findByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.08)
    expect(slider).toHaveAttribute('aria-valuetext', '+10%')
  })

  it('저장·재조회 중에는 손을 뗀 값을 지키고 서버 값이 오면 한 번만 옮긴다(0을 거치지 않는다)', async () => {
    let reads = 0
    routes['GET /simulations/sim-1'] = () => ({
      data: ++reads === 1 ? simulation() : simulation({}, 4),
    })
    let patches = 0
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      return ++patches === 1
        ? {
            status: 409,
            error: { code: 'EDIT_002', message: '최신 상태로 불러왔어요.', details: [] },
          }
        : { data: editState({ [change.code]: change.value }, 5) }
    }
    const slider = await openManual()
    const seen: (number | undefined)[] = []
    const unsubscribe = useEditStore.subscribe((state) =>
      seen.push(state.morphState.weights['nose.bridge_height']),
    )
    // 첫 저장이 응답하기 전에 한 번 더 놓는다. 첫 저장은 충돌 → 재조회(서버 값 0)
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    fireEvent.input(slider, { target: { value: '0.3' } })
    release(slider)
    await waitFor(() => expect(useEditStore.getState().version).toBe(5))
    unsubscribe()
    expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(2)
    expect(bodyOf(calls('PATCH /simulations/sim-1/morph-state')[1])).toEqual({
      stateVersion: 4,
      changes: [{ code: 'nose.bridge_height', value: 0.24 }],
    })
    const released = seen.slice(seen.indexOf(0.24))
    expect(released.length).toBeGreaterThan(1)
    expect(released.every((value) => value === 0.24)).toBe(true)
    expect(slider).toHaveAttribute('aria-valuetext', '+30%')
  })

  it('편집 알림은 한 번에 하나: 저장 실패 알림이 앞 한계 알림을 바꾼다', async () => {
    let patches = 0
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      const [change] = body.changes as { code: string; value: number }[]
      return ++patches === 1
        ? { data: { ...editState({ [change.code]: change.value / 2 }, 4), clamped: true } }
        : { status: 500, error: { code: 'COMMON_001', message: '저장에 실패했어요.', details: [] } }
    }
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.2' } })
    release(slider)
    expect(await screen.findByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).toBeInTheDocument()
    fireEvent.input(slider, { target: { value: '0.5' } })
    release(slider)
    expect(await screen.findByText('저장에 실패했어요.')).toBeInTheDocument()
    expect(screen.queryByText('콧대 높이는 +10%까지만 바꿀 수 있어요')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-toaster] [role="status"] > div')).toHaveLength(1)
  })

  it('편집 방식 탭은 직접 조절·상담 두 개뿐이고 직접 조절이 앞이다(변경내역·서비스 탭은 없앴다, 2026-10-30)', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    const tabs = within(screen.getByRole('tablist', { name: '편집 방식' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['직접 조절', '상담'])
    // 첫 화면은 직접 조절(2026-10-30 사용자 결정)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText('변화 만들기')).not.toBeInTheDocument()
  })
})

describe('SimulationLab — 되돌리기·앞으로·처음으로', () => {
  it('서버 이력으로 되돌리고 앞으로 간다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation({ 'nose.bridge_height': 0.2 }), canUndo: true },
    })
    routes['POST /simulations/sim-1/undo'] = () => ({
      data: {
        ...editState({}, 4, false),
        canRedo: true,
        undoneSummary: '콧대 높이 변경을 취소했어요.',
      },
    })
    routes['POST /simulations/sim-1/redo'] = () => ({
      data: { ...editState({ 'nose.bridge_height': 0.2 }, 5), redoneSummary: '다시 적용했어요.' },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    // 서버 요약(`…변경을 취소했어요.`)이 아니라 슬라이더와 같은 모양의 FE 문구
    expect(await screen.findByText('콧대 높이 0%로 되돌렸어요')).toBeInTheDocument()
    expect(screen.queryByText('콧대 높이 변경을 취소했어요.')).not.toBeInTheDocument()
    expect(bodyOf(calls('POST /simulations/sim-1/undo')[0])).toEqual({ stateVersion: 3 })
    await waitFor(() => expect(screen.getByRole('button', { name: '앞으로 가기' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '앞으로 가기' }))
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.2 }),
    )
    expect(bodyOf(calls('POST /simulations/sim-1/redo')[0])).toEqual({ stateVersion: 4 })
    // 편집 알림은 하나만: 되돌리기 알림을 걷고 앞으로 가기 알림만 남는다(0.2 / 0.8 = +25%)
    expect(await screen.findByText('콧대 높이 +25%로 다시 바꿨어요')).toBeInTheDocument()
    expect(screen.queryByText('콧대 높이 0%로 되돌렸어요')).not.toBeInTheDocument()
    expect(screen.queryByText('다시 적용했어요.')).not.toBeInTheDocument()
  })

  it.each([
    ['요청을 처리하기 전에 서버를 쓸 수 없었을 때', false, 2],
    ['되돌린 뒤 응답만 유실됐을 때', true, 1],
  ])('%s 콧대는 두고 코끝만 한 번 되돌린다', async (_scenario, applied, expectedRequests) => {
    const undoPath = 'POST /simulations/sim-1/undo'
    const before = {
      'nose.bridge_height': 0.12,
      'nose.tip_height': -0.06,
      'nose.tip_rotation': -0.04,
    }
    const after = { 'nose.bridge_height': 0.12 }
    let version = 3
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(version === 3 ? before : after, version),
        canUndo: true,
        canRedo: version === 4,
      },
    })
    routes[undoPath] = () => {
      if (calls(undoPath).length === 1) {
        if (applied) {
          version = 4
          throw new TypeError('연결 끊김')
        }
        return {
          status: 503,
          error: { code: 'COMMON_999', message: '잠시 점검하고 있어요.', details: [] },
        }
      }
      version = 4
      return { data: { ...editState(after, version), canRedo: true } }
    }
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))

    expect(await screen.findByText('자동 저장됨')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual(after)
    expect(screen.getByRole('button', { name: '앞으로 가기' })).toBeEnabled()
    expect(calls('GET /simulations/sim-1')).toHaveLength(2)
    expect(calls(undoPath).map(bodyOf)).toEqual(
      Array.from({ length: expectedRequests }, () => ({ stateVersion: 3 })),
    )
  })

  it('되돌릴 이력이 없으면(EDIT_003) EDIT-03을 다시 읽어 되돌리기를 끈다', async () => {
    let reads = 0
    // 처음에는 되돌릴 수 있다고 받았지만, 다른 탭에서 이미 되돌려 서버에는 이력이 없다
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), canUndo: ++reads === 1 },
    })
    routes['POST /simulations/sim-1/undo'] = () => ({
      status: 409,
      error: { code: 'EDIT_003', message: '되돌릴 변경이 없어요.', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByText('되돌릴 변경이 없어요.')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled())
    // 저장 실패가 아니다
    expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument()
  })

  it('저장한 뒤 EDIT_003이 와도 저장 상태는 자동 저장됨으로 남는다', async () => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
    })
    routes['POST /simulations/sim-1/undo'] = () => ({
      status: 409,
      error: { code: 'EDIT_003', message: '되돌릴 변경이 없어요.', details: [] },
    })
    const slider = await openManual()
    fireEvent.input(slider, { target: { value: '0.2' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByText('되돌릴 변경이 없어요.')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    expect(screen.getByText('자동 저장됨')).toBeInTheDocument()
    expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument()
  })

  it('앞으로 갈 이력이 없으면(EDIT_004) EDIT-03을 다시 읽어 앞으로 가기를 끈다', async () => {
    let reads = 0
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), canRedo: ++reads === 1 },
    })
    routes['POST /simulations/sim-1/redo'] = () => ({
      status: 409,
      error: { code: 'EDIT_004', message: '앞으로 갈 변경이 없어요.', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(screen.getByRole('button', { name: '앞으로 가기' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '앞으로 가기' }))
    expect(await screen.findByText('앞으로 갈 변경이 없어요.')).toBeInTheDocument()
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '앞으로 가기' })).toBeDisabled())
    expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument()
  })

  it('처음으로는 확인 없이 초기화하고 되돌리기 토스트를 띄운다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ 'nose.bridge_height': 0.2 }) })
    routes['POST /simulations/sim-1/reset'] = () => ({ data: editState({}, 4) })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }))
    expect(await screen.findByText('처음 상태로 돌렸어요')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('슬라이더 미리보기 중 처음으로를 누르면 서버의 초기화 결과를 그대로 보여 준다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ 'nose.bridge_height': 0.2 }) })
    routes['POST /simulations/sim-1/reset'] = () => ({ data: editState({}, 4) })
    const slider = await openManual()

    fireEvent.input(slider, { target: { value: '0.3' } })
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.24)
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }))

    await waitFor(() => expect(useEditStore.getState().version).toBe(4))
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(screen.getByTestId('stage')).toHaveTextContent('{}')
  })

  it('처음으로 요청이 실패하면 아직 저장하지 않은 미리보기를 유지한다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ 'nose.bridge_height': 0.2 }) })
    routes['POST /simulations/sim-1/reset'] = () => ({
      status: 500,
      error: { code: 'COMMON_001', message: '초기화에 실패했어요.', details: [] },
    })
    const slider = await openManual()

    fireEvent.input(slider, { target: { value: '0.3' } })
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }))

    expect(await screen.findByText('초기화에 실패했어요.')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.24)
  })
})

describe('SimulationLab — 빠른 저장 뒤 처음으로(S15P31B204-727)', () => {
  const BRIDGE = 'nose.bridge_height'
  /** 예전 시안에 남은 막은 눈 값. 처음으로는 지우지 않는다(BE originalMorphState) */
  const LOCKED = { 'eye.size': 0.1 }
  let saved: Record<string, number>
  let version: number
  let toastsSeen: string[]
  let shownBridge: (number | undefined)[]
  let stopWatching = () => {}

  /** 저장(PATCH)과 처음으로(POST reset) 응답을 붙잡아 두는 문. `open`을 부르면 한꺼번에 흘려보낸다 */
  function holdResponses(paths: RegExp) {
    const respond = vi.mocked(fetch).getMockImplementation()!
    let open = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await respond(input, init)
      if (paths.test(String(input))) await gate
      return response
    })
    return () => act(async () => open())
  }

  beforeEach(() => {
    saved = { [BRIDGE]: 0.2, ...LOCKED }
    version = 3
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ ...saved }, version) })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => {
      for (const { code, value } of body.changes as { code: string; value: number }[])
        saved[code] = value
      version += 1
      return { data: editState({ ...saved }, version) }
    }
    routes['POST /simulations/sim-1/reset'] = () => {
      saved = { ...LOCKED }
      version += 1
      return { data: editState({ ...saved }, version) }
    }
    toastsSeen = []
    shownBridge = []
    const unToast = useToastStore.subscribe((state) => {
      for (const { message } of state.items)
        if (toastsSeen.at(-1) !== message) toastsSeen.push(message)
    })
    const unStore = useEditStore.subscribe((state) =>
      shownBridge.push(state.morphState.weights[BRIDGE]),
    )
    stopWatching = () => {
      unToast()
      unStore()
    }
  })

  afterEach(() => stopWatching())

  /**
   * 콧대를 세 번 빠르게 놓는다. 첫 저장은 응답을 기다리고 나머지는 줄을 선다.
   * 코는 서버가 값을 더 줄일 수 있어 응답 전에는 저장 알림을 띄우지 않는다(S15P31B204-852)
   */
  async function quickCommits() {
    const slider = await openManual()
    for (const value of ['0.3', '0.5', '0.6']) {
      fireEvent.input(slider, { target: { value } })
      release(slider)
    }
    expect(toastsSeen).toEqual([])
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    return slider
  }

  /** 처음으로를 누른 뒤의 알림만 본다. 그 뒤에 지난 저장 알림(`…바꿨어요`)이 다시 뜨면 안 된다(-727) */
  const savedToastAfter = (from: number) =>
    toastsSeen.slice(from).some((message) => message.endsWith('바꿨어요'))

  const resetButton = () => screen.getByRole('button', { name: '처음으로' })
  const toolbarUndo = () =>
    screen
      .getAllByRole('button', { name: '되돌리기' })
      .find((button) => !button.closest('[data-toaster]'))!
  const toastUndo = () =>
    within(document.querySelector<HTMLElement>('[data-toaster]')!).getByRole('button', {
      name: '되돌리기',
    })

  it('줄 선 저장을 기다리지 않고 원본을 바로 보이고, 지난 저장 알림 없이 서버 상태로 끝난다', async () => {
    const openGate = holdResponses(/\/(morph-state|reset)$/)
    const slider = await quickCommits()
    const resetAt = toastsSeen.length

    fireEvent.click(resetButton())
    // 누르자마자: 코는 원본, 막은 눈 값은 남고 점·눈 편집은 비운다. 알림도 바로 뜬다
    expect(useEditStore.getState().morphState).toMatchObject({
      weights: LOCKED,
      pointStrokes: [],
      eyeEdit: null,
    })
    expect(screen.getByTestId('stage')).not.toHaveTextContent(BRIDGE)
    expect(slider).toHaveAttribute('aria-valuetext', '0%')
    expect(screen.getByText('처음 상태로 돌렸어요')).toBeInTheDocument()
    // 처음으로가 끝날 때까지 되돌리기·앞으로 가기·처음으로·슬라이더를 끈다
    expect(toolbarUndo()).toBeDisabled()
    expect(screen.getByRole('button', { name: '앞으로 가기' })).toBeDisabled()
    expect(resetButton()).toBeDisabled()
    expect(slider).toBeDisabled()
    const clickedAt = shownBridge.length

    await openGate()
    await waitFor(() => expect(calls('POST /simulations/sim-1/reset')).toHaveLength(1))
    await waitFor(() => expect(useEditStore.getState().version).toBe(7))

    // 앞 저장은 버리거나 합치지 않고 순서대로 보낸 뒤 처음으로를 보낸다(이력 유지)
    expect(calls('PATCH /simulations/sim-1/morph-state').map((call) => bodyOf(call))).toEqual([
      { stateVersion: 3, changes: [{ code: BRIDGE, value: 0.24 }] },
      { stateVersion: 4, changes: [{ code: BRIDGE, value: 0.4 }] },
      { stateVersion: 5, changes: [{ code: BRIDGE, value: 0.48 }] },
    ])
    expect(bodyOf(calls('POST /simulations/sim-1/reset')[0])).toEqual({ stateVersion: 6 })
    // 기다리는 동안 화면은 중간 값으로 튀지 않았고, 지난 저장 알림은 한 번도 뜨지 않았다
    expect(shownBridge.slice(clickedAt).every((value) => value === undefined)).toBe(true)
    expect(savedToastAfter(resetAt)).toBe(false)
    expect(toastsSeen.at(-1)).toBe('처음 상태로 돌렸어요')
    expect(useEditStore.getState()).toMatchObject({
      morphState: { weights: LOCKED },
      version: 7,
      isDirty: false,
    })
    await waitFor(() => expect(resetButton()).toBeDisabled())
    expect(slider).toBeEnabled()
  })

  it('처음으로가 실패하면 마지막 서버 상태로 돌리고 오류 알림으로 바꾼다', async () => {
    routes['POST /simulations/sim-1/reset'] = () => ({
      status: 500,
      error: { code: 'COMMON_001', message: '초기화에 실패했어요.', details: [] },
    })
    const openGate = holdResponses(/\/morph-state$/)
    await quickCommits()
    const resetAt = toastsSeen.length

    fireEvent.click(resetButton())
    expect(useEditStore.getState().morphState.weights).toEqual(LOCKED)
    await openGate()

    expect(await screen.findByText('초기화에 실패했어요.')).toBeInTheDocument()
    expect(screen.queryByText('처음 상태로 돌렸어요')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights).toEqual({ [BRIDGE]: 0.48, ...LOCKED }),
    )
    expect(useEditStore.getState().version).toBe(6)
    expect(toolbarUndo()).toBeEnabled()
    expect(savedToastAfter(resetAt)).toBe(false)
  })

  it('알림의 되돌리기를 처음으로가 끝나기 전에 눌러도 처음으로 뒤에 보내 직전 상태로 돌린다', async () => {
    routes['POST /simulations/sim-1/undo'] = (body) => {
      saved = { [BRIDGE]: 0.48, ...LOCKED }
      version += 1
      expect(body).toEqual({ stateVersion: 7 })
      return { data: { ...editState({ ...saved }, version), canRedo: true } }
    }
    const openGate = holdResponses(/\/(morph-state|reset)$/)
    await quickCommits()
    const resetAt = toastsSeen.length

    fireEvent.click(resetButton())
    fireEvent.click(toastUndo())
    expect(calls('POST /simulations/sim-1/undo')).toHaveLength(0)

    await openGate()
    await waitFor(() => expect(calls('POST /simulations/sim-1/undo')).toHaveLength(1))
    expect(await screen.findByText('콧대 높이 +60%로 되돌렸어요')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual({ [BRIDGE]: 0.48, ...LOCKED })
    expect(useEditStore.getState().version).toBe(8)
    expect(savedToastAfter(resetAt)).toBe(false)
  })

  it('알림의 되돌리기를 처음으로가 끝난 뒤 누르면 바로 되돌린다', async () => {
    routes['POST /simulations/sim-1/undo'] = () => {
      saved = { [BRIDGE]: 0.2, ...LOCKED }
      version += 1
      return { data: { ...editState({ ...saved }, version), canRedo: true } }
    }
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(resetButton())
    await waitFor(() => expect(useEditStore.getState().version).toBe(4))

    fireEvent.click(toastUndo())
    expect(await screen.findByText('콧대 높이 +25%로 되돌렸어요')).toBeInTheDocument()
    expect(bodyOf(calls('POST /simulations/sim-1/undo')[0])).toEqual({ stateVersion: 4 })
    expect(useEditStore.getState().morphState.weights).toEqual({ [BRIDGE]: 0.2, ...LOCKED })
  })

  it('코를 잇달아 놓아 범위 안에서 줄 선 저장이 모두 끝나도 알림은 없다(-839·-852)', async () => {
    const openGate = holdResponses(/\/morph-state$/)
    await quickCommits()
    expect(useEditStore.getState().version).toBe(3)
    await openGate()
    await waitFor(() => expect(useEditStore.getState().version).toBe(6))
    expect(toastsSeen).toEqual([])
  })
})

describe('SimulationLab — 완료(S15P31B204-844)', () => {
  const toasts = () => useToastStore.getState().items
  const done = () => screen.getByRole('button', { name: /^(완료|저장하는 중)$/ })

  /** 저장(PATCH) 응답을 붙잡아 두는 문. 돌려준 함수를 부르면 흘려보낸다 */
  function holdSaves() {
    const respond = vi.mocked(fetch).getMockImplementation()!
    let open = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const response = await respond(input, init)
      if (/\/morph-state$/.test(String(input))) await gate
      return response
    })
    return () => act(async () => open())
  }

  function saveSlider(slider: HTMLElement, value: string) {
    fireEvent.input(slider, { target: { value } })
    act(() => slider.dispatchEvent(new Event('change', { bubbles: true })))
  }

  beforeEach(() => {
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState(
        Object.fromEntries(
          (body.changes as { code: string; value: number }[]).map(({ code, value }) => [
            code,
            value,
          ]),
        ),
        Number(body.stateVersion) + 1,
      ),
    })
    // 설문은 아래 따로 본다
    markSurveyAfterDone()
  })

  it('저장이 끝날 때까지 기다렸다가 알림을 띄우고 작업실 시안 탭으로 간다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: { ...simulation(), title: '콧대 시안' } })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('콧대 시안')
    fireEvent.click(screen.getByRole('tab', { name: '직접 조절' }))
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    await waitFor(() => expect(slider).toBeEnabled())
    const openGate = holdSaves()
    saveSlider(slider, '0.3')
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))

    fireEvent.click(done())
    // 저장 응답 전에는 떠나지 않고, 버튼을 `저장하는 중`으로 끈다
    expect(await screen.findByRole('button', { name: '저장하는 중' })).toBeDisabled()
    expect(navigation.push).not.toHaveBeenCalled()
    // 손을 뗀 저장의 편집 알림은 응답 전에 바로 뜬다(-839). 완료 알림은 저장이 끝나야 뜬다
    expect(toasts().map((t) => t.message)).not.toContain('시안을 저장했어요')

    await openGate()
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records'))
    // 처음 저장으로 바꾼 것이 생긴 시안이다(응답 전 화면 값이 아니라 저장 뒤 시안으로 판단). 이름을 정해 둬서 버튼이 없다
    const saved = toasts().find((t) => t.message === '시안을 저장했어요')
    expect(saved).toBeDefined()
    expect(saved?.action).toBeUndefined()
  })

  it('이름이 자동으로 붙은 그대로면 알림에 이름 바꾸기를 붙이고, 누르면 편집실 제목을 고치러 돌아온다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), title: '2026.11.15 시안 3', hasChanges: true },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.11.15 시안 3')
    fireEvent.click(done())
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records'))
    expect(toasts()[0]).toMatchObject({
      message: '시안을 저장했어요',
      action: { label: '이름 바꾸기' },
    })

    fireEvent.click(await screen.findByRole('button', { name: '이름 바꾸기' }))
    expect(navigation.push).toHaveBeenLastCalledWith('/simulations/sim-1?rename=1')
  })

  it('`?rename=1`로 열면 제목을 입력칸으로 열고 주소에서 지운다', async () => {
    navigation.search = 'rename=1'
    render(<SimulationLab simulationId="sim-1" />)
    const input = await screen.findByRole('textbox', { name: '시안 이름' })
    expect(input).toHaveValue('2026.10.25 시안')
    await waitFor(() => expect(input).toHaveFocus())
    expect(navigation.replace).toHaveBeenCalledWith('/simulations/sim-1')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /2026.10.25 시안/ })).toBeInTheDocument()
  })

  it('바꾼 것이 없는 시안은 시안에 남지 않는다고 알리고 간다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(done())
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records'))
    expect(toasts().map((t) => t.message)).toEqual(['바꾼 내용이 없어 시안에 남지 않았어요'])
  })

  it('저장이 실패하면 떠나지 않고 다시 누를 수 있다', async () => {
    const slider = await openManual()
    await waitFor(() => expect(slider).toBeEnabled())
    routes['PATCH /simulations/sim-1/morph-state'] = () => ({
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: '저장 실패' },
    })
    const openGate = holdSaves()
    saveSlider(slider, '0.3')
    fireEvent.click(done())
    await openGate()
    await waitFor(() => expect(done()).toHaveTextContent('완료'))
    expect(done()).toBeEnabled()
    expect(navigation.push).not.toHaveBeenCalled()
  })

  it('처음 완료할 때 한 번만 설문을 권하고, 닫으면 작업실로 간다(1차 배포, -434)', async () => {
    // 설문 기간 안으로 시계를 맞춘다(마감 전에만 권한다, S15P31B204-851). 타이머는 진짜를 쓴다
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(SURVEY_ENDS_AT - 60_000)
    clearSurveyAfterDone()
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), title: '콧대 시안', hasChanges: true },
    })
    const { unmount } = render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('콧대 시안')
    fireEvent.click(done())
    const dialog = await screen.findByRole('dialog', { name: '시안을 저장했어요' })
    expect(dialog).toHaveTextContent('설문으로 들려주세요')
    expect(navigation.push).not.toHaveBeenCalled()

    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    fireEvent.click(within(dialog).getByRole('button', { name: '설문조사 하러 가기' }))
    expect(open).toHaveBeenCalledWith(SURVEY_URL, '_blank', 'noopener,noreferrer')
    open.mockRestore()
    expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records')
    expect(toasts().map((t) => t.message)).toEqual(['시안을 저장했어요'])
    unmount()

    // 다음 완료부터는 묻지 않고 바로 간다
    navigation.push.mockReset()
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('콧대 시안')
    fireEvent.click(done())
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records'))
    expect(screen.queryByRole('dialog', { name: '시안을 저장했어요' })).not.toBeInTheDocument()
  })

  it('설문 마감(2026-11-17 0시 KST) 뒤에는 설문 칩이 없고, 완료를 눌러도 설문 창 없이 작업실로 간다(S15P31B204-851)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(SURVEY_ENDS_AT)
    clearSurveyAfterDone()
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), title: '콧대 시안', hasChanges: true },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('콧대 시안')
    expect(screen.queryByRole('button', { name: /설문 참여하기/ })).not.toBeInTheDocument()

    fireEvent.click(done())
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/studio?tab=records'))
    expect(screen.queryByRole('dialog', { name: '시안을 저장했어요' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '설문조사 하러 가기' })).not.toBeInTheDocument()
    expect(toasts().map((t) => t.message)).toEqual(['시안을 저장했어요'])
  })
})

const EDIT_030_TEXT = '이 3D는 아직 대화로 바로 바꿀 수 없어요. 얼굴은 바꾸지 않았어요.'
const EDIT_030_WITH_SKIPPED = `${EDIT_030_TEXT} 미적용: 입술도 두껍게: 눈·코 외 부위는 아직 편집하지 않아요.`
const EYE_UNAVAILABLE_TEXT =
  '이 모델에서는 해당 눈 조절을 사용할 수 없어요. 얼굴은 바꾸지 않았어요.'

describe('SimulationLab — AI 실장님(CON-01 → EDIT-05)', () => {
  function sendResult(overrides: Record<string, unknown> = {}) {
    return {
      userMessage: { id: 'u1', content: '콧대를 좀 올려줘', masked: false },
      assistantMessage: {
        id: 'a1',
        sender: 'AI 실장님',
        content: '',
        intent: 'EDIT',
        filtered: false,
      },
      changeRequest: {
        requestId: 'cr-1',
        status: 'COMPLETE',
        schemaVersion: 'v2',
        actions: [{ code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'small' }],
        skipped: [{ source: '입술도 두껍게', reason: '눈·코 외 부위는 아직 편집하지 않아요.' }],
      },
      needsClarification: false,
      options: [],
      recommendedSliderCode: null,
      morphResult: null,
      ...overrides,
    }
  }

  it('상단 상담 탭에 마지막으로 선택한 슬라이더를 넘겨 그 항목만 저장하고 되돌린다', async () => {
    const original = { 'nose.alar_width': 0.2 }
    const applied = { ...original, 'nose.bridge_height': 0.1 }
    let saved = false
    routes['GET /simulations/sim-1'] = () => ({
      data: saved ? { ...simulation(applied, 4), canUndo: true } : simulation(original),
    })
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => {
      saved = true
      return {
        data: {
          ...editState(applied, 4),
          seq: 4,
          applied: [{ code: 'nose.bridge_height', from: 0, to: 0.1, limited: false }],
          skipped: [],
          limited: false,
          summary: '콧대 높이 변경',
        },
      }
    }
    routes['POST /simulations/sim-1/undo'] = () => ({
      data: { ...editState(original, 5, false), canRedo: true },
    })
    const lab = render(<SimulationLab simulationId="sim-1" />)
    const bridge = await screen.findByRole('slider', { name: '콧대 높이' })
    expect(screen.queryByRole('button', { name: /상담하기/ })).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('slider', { name: '콧볼 너비' }))
    fireEvent.pointerDown(bridge)
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    expect(screen.getByText('선택한 조절 · 콧대 높이')).toBeVisible()
    expect(calls('POST /simulations/sim-1/messages')).toHaveLength(0)
    expect(useEditStore.getState().morphState.weights).toEqual(original)
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '여기만 조금 올려줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))

    await screen.findByRole('region', { name: '3D 반영 결과' })
    expect(bodyOf(calls('POST /simulations/sim-1/messages')[0])).toMatchObject({
      content: '여기만 조금 올려줘',
      directControl: { code: 'nose.bridge_height', stateVersion: 3 },
    })
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(1)
    expect(useEditStore.getState().morphState.weights).toEqual(applied)
    fireEvent.click(screen.getByRole('button', { name: '선택한 조절 지우기' }))
    expect(screen.queryByText('선택한 조절 · 콧대 높이')).not.toBeInTheDocument()

    lab.unmount()
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    expect(useEditStore.getState().morphState.weights).toEqual(applied)
    const undo = screen.getByRole('button', { name: '되돌리기' })
    await waitFor(() => expect(undo).toBeEnabled())
    fireEvent.click(undo)
    await waitFor(() => expect(useEditStore.getState().morphState.weights).toEqual(original))
    expect(calls('POST /simulations/sim-1/undo')).toHaveLength(1)
  })

  it('체중 변화 채팅 결과에서 직접 조절 탭으로 돌아가도 체중 값을 조절할 수 있다', async () => {
    glbContourCodes = [WEIGHT_SHAPE_CODE]
    routes['GET /morph-parameters'] = () => ({ data: WEIGHT_CATALOG })
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(), weightShapeSupported: true },
    })
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        changeRequest: {
          requestId: 'cr-1',
          status: 'COMPLETE',
          schemaVersion: 'v1',
          actions: [{ code: WEIGHT_SHAPE_CODE, side: 'both', direction: -1, strength: 'small' }],
          skipped: [],
        },
      }),
    })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      data: {
        ...editState({ [WEIGHT_SHAPE_CODE]: -0.1 }, 4),
        seq: 1,
        applied: [{ code: WEIGHT_SHAPE_CODE, from: 0, to: -0.1, limited: false }],
        skipped: [],
        limited: false,
        summary: '체중 변화 변경',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))
    const card = await screen.findByRole('region', { name: '3D 반영 결과' })
    fireEvent.click(within(card).getByRole('button', { name: /직접 조절하기/ }))
    expect(screen.getByRole('tab', { name: '체중' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('slider', { name: '체중 변화 감량·증량' })).toHaveFocus()
    expect(useEditStore.getState().morphState.weights[WEIGHT_SHAPE_CODE]).toBe(-0.1)
  })

  it('체중과 윤곽 복합 요청의 검사 거절을 채팅에 안내하고 3D를 유지한다', async () => {
    glbContourCodes = [WEIGHT_SHAPE_CODE, CHEEK]
    routes['GET /morph-parameters'] = () => ({ data: COMBINED_CATALOG })
    const initial = { [WEIGHT_SHAPE_CODE]: 0.4 }
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation(initial), weightShapeSupported: true },
    })
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        changeRequest: {
          requestId: 'cr-1',
          status: 'COMPLETE',
          schemaVersion: 'v2',
          actions: [{ code: CHEEK, side: 'both', direction: 1, strength: 'small' }],
          skipped: [],
        },
      }),
    })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 400,
      error: { code: 'EDIT_001', message: '저장하지 못했어요.', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    const chat = screen.getByRole('region', { name: '상담 대화' })
    expect(within(chat).queryByRole('button', { name: /콧대|광대/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '광대를 조금 키워줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(await within(chat).findByText(WEIGHT_CONTOUR_REJECTED)).toBeInTheDocument()
    expect(screen.getByTestId('stage')).toHaveTextContent(`"${WEIGHT_SHAPE_CODE}":0.4`)
    expect(screen.getByTestId('stage')).not.toHaveTextContent(CHEEK)
  })

  it('COMPLETE 변경 요청이면 확인 없이 EDIT-05를 부르고 실제 반영값으로 카드를 그린다', async () => {
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: 'https://cdn.test/head.glb',
        rigUrl: 'https://cdn.test/rig.json',
        morphSchemaVersion: 'v1',
      },
    })
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      data: {
        ...editState({ 'nose.bridge_height': 0.1 }, 4),
        seq: 1,
        applied: [{ code: 'nose.bridge_height', from: 0, to: 0.1, limited: false }],
        skipped: [{ source: '입술도 두껍게', reason: '눈·코 외 부위는 아직 편집하지 않아요.' }],
        limited: false,
        summary: '콧대 높이 변경',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    const card = await screen.findByRole('region', { name: '3D 반영 결과' })
    expect(within(card).getByText('콧대를 올려드렸어요.')).toBeVisible()
    expect(within(card).getByText('0% → +10%')).not.toBeVisible()
    fireEvent.click(within(card).getByText('조절값 보기'))
    expect(within(card).getByText('0% → +10%')).toBeVisible()
    expect(within(card).queryByText('반영됨')).not.toBeInTheDocument()
    expect(within(card).queryByText('“콧대를 좀 올려줘”')).not.toBeInTheDocument()
    expect(within(card).getByText(/입술도 두껍게/)).toBeInTheDocument()
    expect(bodyOf(calls('POST /simulations/sim-1/messages')[0])).toMatchObject({
      content: '콧대를 좀 올려줘',
      exampleId: 'ex-01',
      requestId: expect.any(String),
    })
    expect(bodyOf(calls('POST /simulations/sim-1/change-requests/cr-1/apply')[0])).toEqual({
      stateVersion: 3,
    })
    expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.1 })
    fireEvent.click(within(card).getByRole('button', { name: '콧대 높이 직접 조절하기' }))
    expect(screen.getByRole('slider', { name: '콧대 높이' })).toHaveFocus()
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(1)
  })

  it('서버가 조절 한계로 줄인 값만 After와 카드에 보여 준다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      data: {
        ...editState({ 'nose.bridge_height': 0.05 }, 4),
        seq: 1,
        applied: [{ code: 'nose.bridge_height', from: 0, to: 0.05, limited: true }],
        skipped: [],
        limited: true,
        summary: '콧대 높이 변경',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    const card = await screen.findByRole('region', { name: '3D 반영 결과' })
    expect(within(card).getByText(/가능한 범위까지만 반영했어요/)).toBeVisible()
    fireEvent.click(within(card).getByText('조절값 보기'))
    expect(within(card).getByText('0% → +5% · 조절 한계')).toBeVisible()
    expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.05 })
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.05')
  })

  it('복합 요청의 두 실제 적용값과 한계 안내를 After와 카드에 함께 보여 준다', async () => {
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
    const actual = { 'nose.bridge_height': 0.05, 'nose.alar_width': -0.2 }
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        changeRequest: {
          requestId: 'cr-1',
          status: 'COMPLETE',
          schemaVersion: 'v2',
          actions: [
            { code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'large' },
            { code: 'nose.alar_width', side: 'both', direction: -1, strength: 'large' },
          ],
          skipped: [],
        },
      }),
    })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      data: {
        ...editState(actual, 4),
        seq: 1,
        applied: [
          { code: 'nose.bridge_height', from: 0, to: 0.05, limited: true },
          { code: 'nose.alar_width', from: 0, to: -0.2, limited: true },
        ],
        skipped: [],
        limited: true,
        summary: '콧대 높이, 콧볼 너비 변경',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    const card = await screen.findByRole('region', { name: '3D 반영 결과' })
    expect(within(card).getByText('콧대를 올려드렸어요.')).toBeVisible()
    expect(within(card).getByText('콧볼을 좁혀드렸어요.')).toBeVisible()
    expect(within(card).getByText(/가능한 범위까지만 반영했어요/)).toBeVisible()
    fireEvent.click(within(card).getByText('조절값 보기'))
    expect(within(card).getByText('0% → +5% · 조절 한계')).toBeVisible()
    expect(within(card).getByText('0% → -20% · 조절 한계')).toBeVisible()
    expect(useEditStore.getState().morphState.weights).toEqual(actual)
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.05')
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.alar_width":-0.2')
    expect(
      within(card).getByRole('button', { name: '콧대 높이 직접 조절하기' }),
    ).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: '콧볼 너비 직접 조절하기' }))
    expect(screen.getByRole('slider', { name: '콧볼 너비' })).toHaveFocus()
  })

  it('되묻기(CLARIFY)면 반영하지 않고 선택지를 보이며, 고르면 selectedOptionId로 보낸다', async () => {
    routes['POST /simulations/sim-1/messages'] = (body) =>
      body.selectedOptionId
        ? {
            data: sendResult({
              assistantMessage: {
                id: 'a2',
                sender: 'AI 실장님',
                content: '알려 주셔서 고마워요.',
                intent: 'REPLY',
                filtered: false,
              },
              changeRequest: null,
            }),
          }
        : {
            data: sendResult({
              assistantMessage: {
                id: 'a1',
                sender: 'AI 실장님',
                content: '어느 부위를 살펴볼까요?',
                intent: 'CLARIFY',
                filtered: false,
              },
              changeRequest: null,
              needsClarification: true,
              options: [
                { id: 'o-eye', label: '눈' },
                { id: 'o-nose', label: '코' },
              ],
            }),
          }
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '좀 더 예쁘게 해줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: /AI 실장님께 보내기/ }))

    expect(await screen.findByText('어느 부위를 살펴볼까요?')).toBeInTheDocument()
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(0)
    expect(screen.getByLabelText('원하는 변화')).toHaveValue('')

    fireEvent.click(
      within(screen.getByRole('group', { name: '답변 고르기' })).getByRole('button', {
        name: /코/,
      }),
    )
    await waitFor(() => expect(calls('POST /simulations/sim-1/messages')).toHaveLength(2))
    expect(bodyOf(calls('POST /simulations/sim-1/messages')[1])).toMatchObject({
      content: '코',
      selectedOptionId: 'o-nose',
      requestId: expect.any(String),
    })
  })

  it('AI 실패(CON_002)면 얼굴을 바꾸지 않고 서버 문구를 보이며 입력을 남긴다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({
      status: 504,
      error: {
        code: 'CON_002',
        message: '얼굴은 바꾸지 않았어요. 잠시 후 다시 보내 주세요.',
        details: [],
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByLabelText('원하는 변화'), { target: { value: '콧대 올려줘' } })
    fireEvent.click(screen.getByRole('button', { name: /AI 실장님께 보내기/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('얼굴은 바꾸지 않았어요')
    expect(screen.getByLabelText('원하는 변화')).toHaveValue('콧대 올려줘')
    expect(screen.queryByRole('list', { name: '상담 내역' })).not.toBeInTheDocument()
    const firstId = bodyOf(calls('POST /simulations/sim-1/messages')[0]).requestId
    fireEvent.click(screen.getByRole('button', { name: /AI 실장님께 보내기/ }))
    await waitFor(() => expect(calls('POST /simulations/sim-1/messages')).toHaveLength(2))
    expect(bodyOf(calls('POST /simulations/sim-1/messages')[1]).requestId).toBe(firstId)
  })

  it('결과 불명 뒤 같은 상담 ID가 중복되면 새 편집 없이 상태 확인을 안내한다', async () => {
    let sent = 0
    routes['POST /simulations/sim-1/messages'] = () =>
      ++sent === 1
        ? { status: 502, error: { code: 'CON_003', message: '답변을 확인할 수 없어요.' } }
        : { status: 409, error: { code: 'CON_011', message: '중복 요청입니다.' } }
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '코 모양을 다듬어줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    await screen.findByText('답변을 확인할 수 없어요.')
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('대화 내역에 결과가 없으면')
    expect(calls('GET /simulations/sim-1/messages')).toHaveLength(2)
    expect(calls('POST /simulations/sim-1/messages')).toHaveLength(2)
    expect(bodyOf(calls('POST /simulations/sim-1/messages')[1]).requestId).toBe(
      bodyOf(calls('POST /simulations/sim-1/messages')[0]).requestId,
    )
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(0)
    expect(screen.getByLabelText('원하는 변화')).toHaveValue('코 모양을 다듬어줘')
    expect(screen.queryByRole('list', { name: '상담 내역' })).not.toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('중복 상담 때 첫 요청의 답변이 저장돼 있다면 내역을 복원한다', async () => {
    let sent = 0
    let reloaded = false
    routes['POST /simulations/sim-1/messages'] = () =>
      ++sent === 1
        ? { status: 502, error: { code: 'CON_003', message: '답변을 확인할 수 없어요.' } }
        : { status: 409, error: { code: 'CON_011', message: '중복 요청입니다.' } }
    routes['GET /simulations/sim-1/messages'] = () => ({
      data: {
        items: reloaded
          ? [
              {
                messageId: 'u1',
                role: 'USER',
                sender: null,
                content: '코 모양을 다듬어줘',
                intent: null,
                needsClarification: false,
                options: [],
                changeRequest: null,
                applyResult: null,
                createdAt: '2026-10-25T00:00:00Z',
              },
              {
                messageId: 'a1',
                role: 'ASSISTANT',
                sender: 'AI 실장님',
                content: '코의 어느 부분을 바꿀까요?',
                intent: 'CLARIFY',
                needsClarification: true,
                options: [],
                changeRequest: null,
                applyResult: null,
                createdAt: '2026-10-25T00:00:01Z',
              },
            ]
          : [],
        page: 0,
        size: 50,
        totalElements: reloaded ? 2 : 0,
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '코 모양을 다듬어줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    await screen.findByText('답변을 확인할 수 없어요.')
    reloaded = true
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))

    expect(await screen.findByText('코의 어느 부분을 바꿀까요?')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('대화 내역에 결과가 없으면')
    expect(calls('GET /simulations/sim-1/messages')).toHaveLength(2)
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(0)
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('반영할 수 없는 요청(CON_010)이면 다시 말해 달라고 안내하고 최신 상태를 다시 읽는다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'CON_010', message: '반영할 수 없는 변경 요청이에요.', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    expect(await screen.findByText(/조금 다르게 다시 말씀해 주세요/)).toBeInTheDocument()
    expect(screen.queryByText(EDIT_030_TEXT)).not.toBeInTheDocument()
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    expect(screen.getByText('반영할 수 없는 변경 요청이에요.')).toBeInTheDocument()
  })

  it('채팅 편집 미지원 모델(EDIT_030)이면 얼굴·카드·undo를 바꾸지 않고, 요청 항목 슬라이더를 열며 재시도하지 않는다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'EDIT_030', message: EDIT_030_TEXT, details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    // 요청한 항목(콧대 높이) 슬라이더가 있는 직접 조절로 넘어가고, 같은 안내를 토스트로도 보인다
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '직접 조절' })).toHaveAttribute('aria-selected', 'true')
    // 토스트는 자기 루트에 따로 그려져 탭 전환보다 늦게 나타날 수 있다(CI처럼 느린 환경). 기다렸다가 찾는다
    expect(await screen.findByText(EDIT_030_WITH_SKIPPED)).toBeInTheDocument()

    // 미리보기를 버리고 EDIT-03을 한 번 다시 읽는다. 같은 요청을 다시 적용하지 않는다
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(1)

    // 성공처럼 갱신하지 않는다: After·undo 그대로, 저장 성공·실패 표시도 없다
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled()
    expect(screen.getByText('변경은 자동 저장돼요')).toBeInTheDocument()
    expect(screen.queryByText('자동 저장됨')).not.toBeInTheDocument()
    expect(screen.queryByText('저장하지 못했어요')).not.toBeInTheDocument()

    // 상담으로 돌아가면 대화가 남아 있고, 반영 카드 없이 미적용 안내가 보인다
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    expect(screen.queryByRole('region', { name: '3D 반영 결과' })).not.toBeInTheDocument()
    expect(screen.getAllByText(EDIT_030_WITH_SKIPPED).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/조금 다르게 다시 말씀해 주세요/)).not.toBeInTheDocument()
    expect(screen.queryByText(/잠시 후 다시 요청해 주세요/)).not.toBeInTheDocument()
  })

  it('검사 승인 없는 모델의 EDIT_030은 슬라이더를 권하지 않는다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: { ...simulation(), capabilities: null } })
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'EDIT_030', message: EDIT_030_TEXT, details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    expect(screen.queryByRole('button', { name: /콧대를 좀 올려줘/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '콧대를 좀 올려줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(await screen.findByText(EDIT_030_WITH_SKIPPED)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '상담' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
    await waitFor(() => expect(calls('GET /simulations/sim-1')).toHaveLength(2))
  })

  it('눈만 요청했으면(EDIT_030) 서버의 무편집 안내를 보이고 슬라이더를 열지 않는다', async () => {
    routes['GET /morph-parameters'] = () => ({ data: CATALOG_WITH_EYE })
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        userMessage: { id: 'u1', content: '오른쪽 눈꼬리만 올려줘', masked: false },
        changeRequest: {
          requestId: 'cr-1',
          status: 'COMPLETE',
          schemaVersion: 'v2',
          actions: [{ code: 'eye.tail_angle', side: 'right', direction: 1, strength: 'small' }],
          skipped: [],
        },
        recommendedSliderCode: 'eye.tail_angle.right',
      }),
    })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'EDIT_030', message: EYE_UNAVAILABLE_TEXT, details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    expect(await screen.findByText(EYE_UNAVAILABLE_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '상담' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByText(EDIT_030_TEXT)).not.toBeInTheDocument()
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(1)
  })

  it('코·눈이 섞인 요청이 EDIT_030이면 코 슬라이더만 연다', async () => {
    routes['GET /morph-parameters'] = () => ({ data: CATALOG_WITH_EYE })
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        changeRequest: {
          requestId: 'cr-1',
          status: 'COMPLETE',
          schemaVersion: 'v2',
          actions: [{ code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'small' }],
          skipped: [{ source: '눈도 크게 해줘', reason: '눈 편집은 지원하지 않습니다.' }],
        },
      }),
    })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'EDIT_030', message: '서버의 최신 안내', details: [] },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))

    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '직접 조절' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('slider', { name: /눈꼬리/ })).not.toBeInTheDocument()
    expect(
      await screen.findByText(
        '서버의 최신 안내 미적용: 눈도 크게 해줘: 눈 편집은 지원하지 않습니다.',
      ),
    ).toBeInTheDocument()
  })

  it('다시 열었을 때 반영되지 않은 요청(COMPLETE·applyResult 없음)은 미적용 안내로 보인다', async () => {
    routes['GET /simulations/sim-1/messages'] = () => ({
      data: {
        items: [
          {
            messageId: 'u1',
            role: 'USER',
            sender: null,
            content: '콧대를 좀 올려줘',
            intent: null,
            needsClarification: false,
            options: [],
            changeRequest: null,
            applyResult: null,
            createdAt: '2026-10-25T00:00:00Z',
          },
          {
            messageId: 'a1',
            role: 'ASSISTANT',
            sender: 'AI 실장님',
            content: '콧대를 조금 높여 볼게요.',
            intent: 'EDIT',
            needsClarification: false,
            options: [],
            changeRequest: {
              requestId: 'cr-1',
              status: 'COMPLETE',
              schemaVersion: 'v2',
              actions: [
                { code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'small' },
              ],
              skipped: [],
            },
            applyResult: null,
            createdAt: '2026-10-25T00:00:01Z',
          },
        ],
        page: 0,
        size: 50,
        totalElements: 2,
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    expect(await screen.findByText('이 요청은 3D에 반영되지 않았어요.')).toBeInTheDocument()
    const version = useEditStore.getState().version
    fireEvent.click(screen.getByText('가능한 다음 조절 보기'))
    expect(calls('POST /simulations/sim-1/messages')).toHaveLength(0)
    expect(calls('POST /simulations/sim-1/change-requests/cr-1/apply')).toHaveLength(0)
    expect(useEditStore.getState().version).toBe(version)
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(screen.queryByText('콧대를 조금 높여 볼게요.')).not.toBeInTheDocument()
  })

  it('EDIT_030 뒤에도 기존 슬라이더는 EDIT-04로 저장된다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({ data: sendResult() })
    routes['POST /simulations/sim-1/change-requests/cr-1/apply'] = () => ({
      status: 409,
      error: { code: 'EDIT_030', message: '미지원', details: [] },
    })
    routes['PATCH /simulations/sim-1/morph-state'] = (body) => ({
      data: editState({ 'nose.bridge_height': (body.changes as { value: number }[])[0].value }, 4),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: /콧대를 좀 올려줘/ }))
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.input(slider, { target: { value: '0.2' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(calls('PATCH /simulations/sim-1/morph-state')).toHaveLength(1))
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.16 }),
    )
  })

  it('UNDO 같은 고정 명령은 morphResult로 3D를 맞춘다', async () => {
    routes['GET /simulations/sim-1'] = () => ({ data: simulation({ 'nose.bridge_height': 0.2 }) })
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        assistantMessage: {
          id: 'a1',
          sender: 'AI 실장님',
          content: '직전 변경을 취소했어요.',
          intent: 'UNDO',
          filtered: false,
        },
        changeRequest: null,
        morphResult: editState({}, 4, false),
      }),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
      target: { value: '방금 거 취소해줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(await screen.findByText('직전 변경을 취소했어요.')).toBeInTheDocument()
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(useEditStore.getState().version).toBe(4)
  })

  it('조절 범위 질문이면 추천 슬라이더를 연다', async () => {
    routes['POST /simulations/sim-1/messages'] = () => ({
      data: sendResult({
        assistantMessage: {
          id: 'a1',
          sender: 'AI 실장님',
          content: '콧대는 이만큼 조절돼요.',
          intent: 'REPLY',
          filtered: false,
        },
        changeRequest: null,
        recommendedSliderCode: 'nose.bridge_height',
      }),
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(screen.getByLabelText('원하는 변화'), {
      target: { value: '콧대는 어느 정도 조절돼?' },
    })
    fireEvent.click(screen.getByRole('button', { name: /AI 실장님께 보내기/ }))
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /직접 조절/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('SimulationLab — 첫 사용 안내(2026-11-03)', () => {
  const card = () => screen.getByRole('dialog', { name: /원본 보기|AI 상담|완료/ })
  const title = () => within(card()).getByRole('heading').textContent

  beforeEach(() => {
    reportReady = true
    clearTutorialRecord(EDITOR_TUTORIAL_STORAGE_KEY)
    routes['GET /morph-parameters'] = () => ({ data: SAMPLE_NOSE_CATALOG })
  })
  afterEach(() => {
    clearTutorialRecord(EDITOR_TUTORIAL_STORAGE_KEY)
    localStorage.clear()
  })

  it('3D가 준비되기 전에는 띄우지 않는다', async () => {
    reportReady = false
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByText('2026.10.25 시안')).toBeInTheDocument()
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })

  it('코 점이 없는 모델은 3단계: 원본 보기 → 상담 → 완료, 해 보면 넘어가고 완료로 남긴다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await waitFor(() => expect(title()).toContain('3단계 중 1단계, 원본 보기'))

    const compare = screen.getByRole('button', { name: '누르고 있는 동안 원본 보기' })
    fireEvent.pointerDown(compare)
    fireEvent.pointerUp(compare)
    await waitFor(() => expect(title()).toContain('AI 상담'))

    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    await waitFor(() => expect(title()).toContain('완료'))
    expect(card()).toHaveTextContent('바꾼 내용은 자동으로 저장돼요')
    expect(card()).toHaveTextContent('원본 얼굴은 그대로 남아 언제든 비교할 수 있어요')

    fireEvent.click(screen.getByRole('button', { name: '완료' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(EDITOR_TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('코 구조 조절을 끄면(기본) 코 점이 있는 모델도 버튼 연결이 없고 안내는 3단계다(-552)', async () => {
    pointEdit.enabled = false
    routes['GET /simulations/sim-1'] = () => ({
      data: {
        ...simulation(),
        capabilities: {
          modelVersion: 'topology',
          rigVersion: 'rig',
          engineVersion: 'engine',
          supported: { 'nose.bridge_height': { min: -1, max: 1 } },
        },
      },
    })
    routes['GET /face-models/fm-1'] = () => ({
      data: {
        faceModelId: 'fm-1',
        meshUrl: 'https://cdn.test/head.glb',
        rigUrl: 'https://cdn.test/rig.json',
        morphSchemaVersion: 'v1',
      },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await waitFor(() => expect(title()).toContain('3단계 중 1단계, 원본 보기'))
    // 가짜 무대는 손잡이 연결(onNoseHandleCommit)을 받을 때만 코 구조 조절·손잡이 버튼을 그린다
    expect(screen.queryByRole('button', { name: '코 구조 조절' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '손잡이 저장' })).not.toBeInTheDocument()
    fireEvent.click(within(card()).getByRole('button', { name: /다음/ }))
    expect(title()).toContain('AI 상담')
  })

  it('단계 막대를 누르면 그 단계로 앞뒤 어디든 옮기고, 완료로 남기지 않는다(-849)', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await waitFor(() => expect(title()).toContain('3단계 중 1단계, 원본 보기'))
    const dash = (n: number) => within(card()).getByRole('button', { name: `${n}단계로 이동` })

    fireEvent.click(dash(3))
    expect(title()).toContain('3단계 중 3단계, 완료')
    expect(dash(3)).toHaveAttribute('aria-current', 'step')

    fireEvent.click(dash(2))
    expect(title()).toContain('3단계 중 2단계, AI 상담')
    expect(dash(2)).toHaveAttribute('aria-current', 'step')
    expect(dash(3)).not.toHaveAttribute('aria-current')

    // 옮긴 단계의 행동을 해 보면 전처럼 다음 단계로 넘어간다
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    await waitFor(() => expect(title()).toContain('3단계 중 3단계, 완료'))
    expect(localStorage.getItem(EDITOR_TUTORIAL_STORAGE_KEY)).toBeNull()
  })

  it('건너뛰면 다시 열어도 띄우지 않는다', async () => {
    const { unmount } = render(<SimulationLab simulationId="sim-1" />)
    await waitFor(() => expect(card()).toBeInTheDocument())
    fireEvent.click(within(card()).getByRole('button', { name: '건너뛰기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(EDITOR_TUTORIAL_STORAGE_KEY)).toBe('skipped')
    unmount()
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByText('2026.10.25 시안')).toBeInTheDocument()
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })
})

describe('SimulationLab — 첫 탭·상담 안내·빈 시안 공유(-748)', () => {
  const EYE_LIMITS = { inner: 30, outer: 30, upper: 30, lower: 30, 'inout:height': 40 }
  const eyeSimulation = () => ({
    ...simulation(),
    eyeReview: { L: 'absent', R: 'absent' },
    eyePartsSha256: 'c'.repeat(64),
    eyeCapabilities: { meshSha256: 'a'.repeat(64), rigSha256: 'b'.repeat(64), limits: EYE_LIMITS },
  })

  it('눈을 조절할 수 있는 모델은 눈 탭을 먼저 연다', async () => {
    glbEvidence = { review: { L: 'absent', R: 'absent' }, eyePartsSha256: 'c'.repeat(64) }
    routes['GET /simulations/sim-1'] = () => ({ data: eyeSimulation() })
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByRole('slider', { name: '앞트임' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '눈' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
  })

  it('3D의 눈 판정을 읽는 동안에는 눈 탭을 미지원으로 막지 않고 불러오는 중으로 보인다', async () => {
    // 가짜 무대가 눈 판정을 알리지 않는다(실제 3D는 GLB를 읽은 뒤 알린다)
    glbEvidence = null
    routes['GET /simulations/sim-1'] = () => ({ data: eyeSimulation() })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    const eyeTab = await screen.findByRole('tab', { name: '눈' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^코/ })).not.toHaveAttribute('aria-disabled'),
    )
    expect(eyeTab).toHaveAttribute('aria-selected', 'true')
    expect(eyeTab).not.toHaveTextContent('미지원')
    expect(screen.getByText('조절 항목을 불러오는 중이에요')).toBeInTheDocument()
    expect(screen.queryByText(/눈 조절에 필요한 형상 정보/)).not.toBeInTheDocument()
  })

  it('눈 판정이 없는 모델은 미지원 눈 탭 대신 코 탭을 먼저 연다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^코/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^눈/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('얼굴 조절값이 있을 때 상담에 체중 전환을 입력하면 원복될 부위를 안내한다', async () => {
    routes['GET /morph-parameters'] = () => ({ data: WEIGHT_CATALOG })
    glbContourCodes = [WEIGHT_SHAPE_CODE]
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation({ 'nose.bridge_height': 0.2 }), weightShapeSupported: true },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.click(screen.getByRole('tab', { name: '상담' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '원하는 변화' }), {
      target: { value: '체중 변화로 전환해줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(screen.getByText('전환하면 코 조절값이 원본으로 돌아가요.')).toBeInTheDocument()
  })

  it('바꾼 것이 없는 시안에서 공유(전송)를 누르면 시트 대신 이유를 알린다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    const share = screen.getByRole('button', { name: '시안 공유' })
    expect(share).toBeEnabled()
    fireEvent.click(share)
    expect(
      await screen.findByText('편집한 내용이 없어 전송할 수 없어요. 먼저 얼굴을 조절해 주세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '링크 만들기' })).not.toBeInTheDocument()
    expect(calls('GET /simulations/sim-1/shares')).toHaveLength(0)
  })

  it('바꾼 것이 있는 시안은 공유 시트를 연다', async () => {
    routes['GET /simulations/sim-1'] = () => ({
      data: { ...simulation({ 'nose.bridge_height': 0.2 }), hasChanges: true },
    })
    routes['GET /simulations/sim-1/shares'] = () => ({ data: [] })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    fireEvent.click(screen.getByRole('button', { name: '시안 공유' }))
    expect(await screen.findByRole('button', { name: '링크 만들기' })).toBeEnabled()
    expect(
      screen.queryByText('편집한 내용이 없어 전송할 수 없어요. 먼저 얼굴을 조절해 주세요.'),
    ).not.toBeInTheDocument()
  })
})

describe('SimulationLab — 도구 줄 시안 이름·모델 이름 (S15P31B204-812)', () => {
  const toasts = () => useToastStore.getState().items.map((t) => t.message)

  it('제목 아래에 "내 모델" 대신 시안을 만든 모델 이름을 보인다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    expect(await screen.findByText('테스트 모델')).toBeInTheDocument()
    expect(screen.queryByText('내 모델')).not.toBeInTheDocument()
  })

  it('모델 목록에서 찾지 못하면 "내 모델"로 보인다', async () => {
    routes['GET /face-models'] = () => ({
      data: { items: [], page: 0, size: 50, totalElements: 0 },
    })
    render(<SimulationLab simulationId="sim-1" />)
    await screen.findByText('2026.10.25 시안')
    await waitFor(() => expect(calls('GET /face-models')).toHaveLength(1))
    expect(screen.getByText('내 모델')).toBeInTheDocument()
  })

  it('제목 옆 연필은 늘 보이고 눌러도 고치기 시작한다. 마우스를 올리면 이름 바꾸기 말풍선이 뜬다(-844)', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    const button = await screen.findByRole('button', { name: /시안 이름 바꾸기/ })
    expect(button).toHaveClass('cursor-text')
    fireEvent.pointerEnter(button.parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('이름 바꾸기')
    expect(button).toHaveAccessibleDescription('이름 바꾸기')
    fireEvent.pointerLeave(button.parentElement!)

    const pencil = button.querySelector('svg')!
    expect(pencil).toBeInTheDocument()
    fireEvent.click(pencil)
    const input = screen.getByRole('textbox', { name: '시안 이름' })
    expect(input).toHaveValue('2026.10.25 시안')
    // 입력칸은 글자 길이와 관계없이 한글 10글자 남짓 고정 폭이다(도구 줄을 가로지르지 않는다)
    expect(input).toHaveClass('w-[11em]', 'max-w-full')
  })

  it('제목을 누르면 그 자리에서 고치고 Enter로 저장한다', async () => {
    routes['PATCH /simulations/sim-1'] = (body) => ({
      data: { simulationId: 'sim-1', title: body.title, updatedAt: '2026-11-13T00:00:00Z' },
    })
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /시안 이름 바꾸기/ }))
    const input = screen.getByRole('textbox', { name: '시안 이름' })
    expect(input).toHaveValue('2026.10.25 시안')
    expect(input).toHaveFocus()
    // 20자를 넘겨 쓸 수 없고, 20자에 닿으면 칸 아래에 안내를 띄운다(S15P31B204-838)
    expect(input).toHaveAttribute('maxLength', '20')
    expect(screen.queryByText('최대 20자까지 쓸 수 있어요')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '나'.repeat(20) } })
    expect(screen.getByText('최대 20자까지 쓸 수 있어요')).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription('최대 20자까지 쓸 수 있어요')
    fireEvent.change(input, { target: { value: '나'.repeat(19) } })
    expect(screen.queryByText('최대 20자까지 쓸 수 있어요')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '  광대 줄인 시안  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: /광대 줄인 시안/ })).toBeInTheDocument()
    expect(calls('PATCH /simulations/sim-1')).toHaveLength(1)
    // 앞뒤 공백은 빼고 보낸다(작업실 이름 바꾸기와 같은 규칙)
    expect(bodyOf(calls('PATCH /simulations/sim-1')[0])).toEqual({ title: '광대 줄인 시안' })
  })

  it('칸 밖을 누르면 저장하고, Esc는 저장하지 않고 원래 이름으로 돌린다', async () => {
    routes['PATCH /simulations/sim-1'] = (body) => ({
      data: { simulationId: 'sim-1', title: body.title, updatedAt: '2026-11-13T00:00:00Z' },
    })
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /시안 이름 바꾸기/ }))
    let input = screen.getByRole('textbox', { name: '시안 이름' })
    fireEvent.change(input, { target: { value: '취소할 이름' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /2026.10.25 시안/ })).toBeInTheDocument()
    expect(calls('PATCH /simulations/sim-1')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /시안 이름 바꾸기/ }))
    input = screen.getByRole('textbox', { name: '시안 이름' })
    fireEvent.change(input, { target: { value: '칸 밖에서 저장' } })
    fireEvent.blur(input)
    expect(await screen.findByRole('button', { name: /칸 밖에서 저장/ })).toBeInTheDocument()
    expect(calls('PATCH /simulations/sim-1')).toHaveLength(1)
  })

  it('빈 이름은 저장하지 않는다. Enter면 고치게 두고, 칸 밖을 누르면 원래 이름으로 돌린다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /시안 이름 바꾸기/ }))
    const input = screen.getByRole('textbox', { name: '시안 이름' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(toasts()).toContain('시안 이름을 적어 주세요.')
    expect(screen.getByRole('textbox', { name: '시안 이름' })).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.getByRole('button', { name: /2026.10.25 시안/ })).toBeInTheDocument()
    expect(calls('PATCH /simulations/sim-1')).toHaveLength(0)
  })

  it('한글 조합 중 Enter(조합 확정)는 저장하지 않는다', async () => {
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /시안 이름 바꾸기/ }))
    const input = screen.getByRole('textbox', { name: '시안 이름' })
    fireEvent.change(input, { target: { value: '조합 중' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(screen.getByRole('textbox', { name: '시안 이름' })).toBeInTheDocument()
    expect(calls('PATCH /simulations/sim-1')).toHaveLength(0)
  })

  it('저장에 실패하면 알리고 원래 이름으로 돌린다', async () => {
    routes['PATCH /simulations/sim-1'] = () => ({
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: '잠시 후 다시 시도해 주세요.' },
    })
    render(<SimulationLab simulationId="sim-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /시안 이름 바꾸기/ }))
    const input = screen.getByRole('textbox', { name: '시안 이름' })
    fireEvent.change(input, { target: { value: '실패할 이름' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: /2026.10.25 시안/ })).toBeInTheDocument()
    expect(toasts().length).toBeGreaterThan(0)
  })
})
