import type { ConsentRecord, Me } from '@/features/auth/types'
import { SAMPLE_CONTOUR_PART } from '@/features/edit/contourControls'
import { SAMPLE_NOSE_CATALOG } from '@/features/edit/noseControls'
import type { Simulation } from '@/features/edit/types'
import type { FaceModelSummary, SimulationSummary } from '@/features/home/types'
import type { NotificationList } from '@/features/notifications/types'
import type { ReconstructionJob } from '@/features/reconstruction/types'
import type { FaceModelDetail } from '@/features/studio/types'
import { API_BASE_URL, ASSET_BASE_URL } from '@/shared/config/env'

/**
 * 개발 서버 전용 보기 전환(S15P31B204-460). 로컬 백엔드 없이 회원·게스트 화면을 확인한다.
 *
 * - `member`: API 요청을 가로채 예시 회원 데이터로 답한다. 모델은 공개 기본 모델(GLB)만 쓴다
 * - `guest`: 세션 복구를 실패로 답해 비로그인 상태로 둔다. 로그인 버튼은 `member`로 바꾼다
 * - 꺼짐(null): 가로채지 않고 실제 백엔드를 부른다
 *
 * 운영 빌드에는 들어가지 않는다(루트 layout이 `NODE_ENV === 'development'`일 때만 불러온다).
 * 실제 얼굴 데이터·토큰은 쓰지 않는다.
 */
export type DevAuthMode = 'member' | 'guest'

export const DEV_AUTH_STORAGE_KEY = 'preface.devAuthView'
/** 로그인 버튼이 돌아오는 주소에 붙는 표시. DevAuthView가 읽고 지운다 */
export const DEV_AUTH_QUERY = 'devAuth'

export function readDevAuthMode(): DevAuthMode | null {
  try {
    const value = window.localStorage.getItem(DEV_AUTH_STORAGE_KEY)
    return value === 'member' || value === 'guest' ? value : null
  } catch {
    return null
  }
}

export function writeDevAuthMode(mode: DevAuthMode | null): void {
  try {
    if (mode) window.localStorage.setItem(DEV_AUTH_STORAGE_KEY, mode)
    else window.localStorage.removeItem(DEV_AUTH_STORAGE_KEY)
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 유지된다
  }
}

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

type Mesh = 'female' | 'male'

const model = (
  faceModelId: string,
  title: string,
  mesh: Mesh,
  age: number,
  simulationCount: number,
) => ({
  summary: {
    faceModelId,
    title,
    thumbnailUrl: `/models/base-${mesh}.webp`,
    createdAt: daysAgo(age),
    simulationCount,
  } satisfies FaceModelSummary,
  mesh,
})

const FACE_MODELS = [
  model('dev-head-1', '내 모델', 'female', 1, 2),
  model('dev-head-2', '내 모델 2', 'male', 4, 1),
  model('dev-head-3', '내 모델 3', 'female', 9, 0),
]
const findModel = (id: string) => FACE_MODELS.find((item) => item.summary.faceModelId === id)

/**
 * 이름 바꾸기(모델 PATCH /face-models/{id}, 시안 PATCH /simulations/{id})를 기억한다(S15P31B204-838).
 * 전에는 보낸 이름을 버리고 처음 이름을 돌려줘, 작업실에서 모델 이름을 바꿔도 편집실 제목 아래가 '내 모델'로 남았다.
 * 새로고침 뒤에도 이어 보게 localStorage에 둔다(막히면 이번 화면에서만)
 */
const DEV_TITLES_KEY = 'preface.devTitles'

function readTitles(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(DEV_TITLES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function saveTitle(id: string, title: string) {
  const titles = { ...readTitles(), [id]: title }
  try {
    window.localStorage.setItem(DEV_TITLES_KEY, JSON.stringify(titles))
  } catch {
    memoryTitles[id] = title
  }
}

const memoryTitles: Record<string, string> = {}
const titleOf = (id: string, fallback: string) => memoryTitles[id] ?? readTitles()[id] ?? fallback

/** 보낸 이름(본문 `title`)을 앞뒤 공백을 빼고 꺼낸다. 없으면 null */
function bodyTitle(body: unknown): string | null {
  const title = (body as { title?: unknown } | null)?.title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

const SIMULATIONS: SimulationSummary[] = [
  {
    simulationId: 'dev-sim-1',
    faceModelId: 'dev-head-1',
    title: '콧대 조금 높이기',
    changedParts: ['NOSE'],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(0.1),
  },
  {
    simulationId: 'dev-sim-2',
    faceModelId: 'dev-head-1',
    title: '코끝 정리',
    changedParts: ['NOSE'],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1.5),
  },
  {
    simulationId: 'dev-sim-3',
    faceModelId: 'dev-head-2',
    title: '시안 1',
    changedParts: ['NOSE'],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
  },
]

const ME: Me = {
  id: 'dev-member',
  nickname: '미리보기 회원',
  maskedEmail: 'pr***@example.com',
  providers: ['KAKAO'],
  createdAt: daysAgo(20),
  reconsentRequired: [],
  dataSummary: { faceModelCount: FACE_MODELS.length, simulationCount: SIMULATIONS.length },
}

const CONSENT_TITLES: Record<ConsentRecord['consentType'], string> = {
  TERMS: '서비스 이용약관',
  PRIVACY: '개인정보 수집·이용',
  FACE_DATA: '얼굴 데이터 처리',
  FACE_PUBLIC: '얼굴 데이터 공개 범위',
}

const CONSENTS: ConsentRecord[] = (
  Object.keys(CONSENT_TITLES) as ConsentRecord['consentType'][]
).map((consentType) => ({
  consentType,
  title: CONSENT_TITLES[consentType],
  version: 'v1',
  effectiveAt: daysAgo(30),
  status: 'AGREED',
  agreedAt: daysAgo(20),
  withdrawnAt: null,
  isLatestVersion: true,
}))

const NOTIFICATIONS: NotificationList = {
  items: [
    {
      notificationId: 'dev-noti-1',
      type: 'RECON_SUCCEEDED',
      title: '3D 얼굴이 완성됐어요',
      body: '내 모델을 작업실에서 확인해 보세요.',
      target: { kind: 'FACE_MODEL', id: 'dev-head-1' },
      readAt: null,
      createdAt: daysAgo(1),
    },
    {
      notificationId: 'dev-noti-2',
      type: 'RECON_FAILED',
      title: '3D 얼굴을 만들지 못했어요',
      body: '얼굴이 잘 보이게 다시 촬영해 주세요.',
      target: { kind: 'RECON_JOB', id: 'dev-job-2' },
      readAt: daysAgo(5),
      createdAt: daysAgo(6),
    },
  ],
  page: 0,
  size: 20,
  totalElements: 2,
  unreadCount: 1,
}

/** AI 상담 예시 대화(개발 화면 전용, 합성 문구). 반영 카드 · 일반 답 · 고르기 질문을 한 번씩 보여 준다 */
const DEV_CONSULT = [
  {
    messageId: 'dev-msg-1',
    role: 'USER',
    sender: null,
    content: '콧대를 좀 올려줘',
    intent: null,
    needsClarification: false,
    options: [],
    changeRequest: null,
    applyResult: null,
    createdAt: daysAgo(1),
  },
  {
    messageId: 'dev-msg-2',
    role: 'ASSISTANT',
    sender: 'AI 실장님',
    content: '',
    intent: 'EDIT',
    needsClarification: false,
    options: [],
    changeRequest: null,
    applyResult: {
      summary: '콧대를 조금 높였어요',
      applied: [{ code: 'nose.bridge_height', from: 0, to: 0.3, limited: false }],
      skipped: [],
      seq: 1,
      limited: false,
    },
    createdAt: daysAgo(1),
  },
  {
    messageId: 'dev-msg-3',
    role: 'USER',
    sender: null,
    content: '자연스러워 보이려면 어느 정도가 좋아?',
    intent: null,
    needsClarification: false,
    options: [],
    changeRequest: null,
    applyResult: null,
    createdAt: daysAgo(1),
  },
  {
    messageId: 'dev-msg-4',
    role: 'ASSISTANT',
    sender: 'AI 실장님',
    content:
      '얼굴 전체 비율에 따라 달라요. 지금처럼 조금씩 올려 보고 옆모습을 함께 확인해 보세요. 결과는 참고용 시뮬레이션이에요.',
    intent: 'REPLY',
    needsClarification: false,
    options: [],
    changeRequest: null,
    applyResult: null,
    createdAt: daysAgo(1),
  },
  {
    messageId: 'dev-msg-5',
    role: 'USER',
    sender: null,
    content: '코끝도 바꿔줘',
    intent: null,
    needsClarification: false,
    options: [],
    changeRequest: null,
    applyResult: null,
    createdAt: daysAgo(1),
  },
  {
    messageId: 'dev-msg-6',
    role: 'ASSISTANT',
    sender: 'AI 실장님',
    content: '코끝을 어느 쪽으로 바꿔 볼까요?',
    intent: 'CLARIFY',
    needsClarification: true,
    options: [
      { id: 'dev-opt-up', label: '살짝 올리기' },
      { id: 'dev-opt-front', label: '앞으로 내밀기' },
    ],
    changeRequest: null,
    applyResult: null,
    createdAt: daysAgo(1),
  },
]

/** 개발용 카탈로그: 코 + 윤곽(서버 시드와 같은 코드) */
const DEV_CATALOG = {
  ...SAMPLE_NOSE_CATALOG,
  parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART],
}

/** 실서버 QR 유효 시간(`preface.capture.link-ttl: 180s`)과 같게 둔다 */
const DEV_QR_TTL_MS = 3 * 60 * 1000
let devLinkExpiresAt: string | null = null

const SUPPORTED = Object.fromEntries(
  DEV_CATALOG.parts
    .flatMap((part) => part.items)
    .map((item) => [item.code, { min: item.min, max: item.max }]),
)

function simulation(id: string): Simulation | null {
  const summary = SIMULATIONS.find((item) => item.simulationId === id)
  if (!summary) return null
  return {
    simulationId: summary.simulationId,
    faceModelId: summary.faceModelId,
    title: titleOf(summary.simulationId, summary.title),
    morphState: { schemaVersion: 'v1', weights: { 'nose.bridge_height': 0.3 } },
    stateVersion: 1,
    currentSeq: 1,
    canUndo: true,
    canRedo: false,
    hasChanges: true,
    capabilities: {
      modelVersion: 'dev',
      rigVersion: 'dev',
      engineVersion: 'dev',
      supported: SUPPORTED,
    },
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  }
}

function faceModelDetail(id: string): FaceModelDetail | null {
  const found = findModel(id)
  if (!found) return null
  return {
    faceModelId: id,
    meshUrl: `/models/base-${found.mesh}.glb`,
    textureUrl: null,
    rigUrl: null,
    meshFormat: 'GLB',
    morphSchemaVersion: 'v1',
    urlExpiresAt: new Date(Date.now() + DAY).toISOString(),
    createdAt: found.summary.createdAt,
  }
}

/** `dev-job-1` 완료, `dev-job-2` 실패(알림의 실패 항목), 그 밖의 id는 3단계 진행 중 */
function job(id: string): ReconstructionJob {
  const base = {
    jobId: id,
    queuePosition: null,
    createdAt: daysAgo(1),
    startedAt: daysAgo(1),
  }
  if (id === 'dev-job-1') {
    return {
      ...base,
      status: 'SUCCEEDED',
      stage: 'FINALIZE',
      stageIndex: 4,
      failCodes: [],
      faceModelId: 'dev-head-1',
      finishedAt: daysAgo(1),
    }
  }
  if (id === 'dev-job-2') {
    return {
      ...base,
      status: 'FAILED',
      stage: 'QUALITY_CHECK',
      stageIndex: 2,
      failCodes: ['QUALITY_NO_FACE'],
      faceModelId: null,
      finishedAt: daysAgo(1),
    }
  }
  return {
    ...base,
    status: 'RUNNING',
    stage: 'RECONSTRUCT',
    stageIndex: 3,
    failCodes: [],
    faceModelId: null,
    finishedAt: null,
  }
}

const page = <T>(items: T[]) => ({ items, page: 0, size: 20, totalElements: items.length })

type Reply = { status: number; data?: unknown; error?: string }

const ok = (data: unknown, status = 200): Reply => ({ status, data })
const fail = (status: number, error: string): Reply => ({ status, error })

/**
 * 휴대폰 촬영 화면(`/m/capture#t=dev-preview-token`)을 개발 화면에서 열어 볼 수 있게 QR 토큰 교환만 흉내 낸다(합성 값).
 * 실제 촬영·업로드는 하지 않는다. 휴대폰은 로그인하지 않으므로 회원·게스트 보기 모두에서 받는다
 */
function captureReply(method: string, path: string): Reply | null {
  if (method === 'POST' && path === '/capture-links/exchange') {
    return ok({
      captureSessionToken: 'dev-capture-session',
      expiresIn: 1800,
      linkId: 'dev-link-1',
      user: { nickname: '미리보기', maskedEmail: 'pr***@example.com' },
    })
  }
  return null
}

function memberReply(method: string, path: string, body: unknown = null): Reply {
  const capture = captureReply(method, path)
  if (capture) return capture
  const [, a, b, c] = path.split('/')

  if (method === 'POST' && path === '/auth/token/refresh')
    return ok({ accessToken: 'dev-member', expiresIn: 3600 })
  if (method === 'POST' && path === '/auth/logout') {
    writeDevAuthMode('guest')
    return ok({})
  }
  if (path === '/users/me')
    return method === 'GET' ? ok(ME) : ok({ deletionStatus: 'PENDING' }, 202)
  if (path === '/users/me/consents') return ok(CONSENTS)
  if (method === 'GET' && path === '/consent-documents') return ok(DEV_CONSENT_DOCUMENTS)
  if (path === '/morph-parameters') return ok(DEV_CATALOG)

  if (a === 'face-models') {
    if (!b)
      return ok(
        page(
          FACE_MODELS.map((item) => ({
            ...item.summary,
            title: titleOf(item.summary.faceModelId, item.summary.title),
          })),
        ),
      )
    const found = findModel(b)
    if (!found) return fail(404, 'HIS_001')
    if (c === 'simulations' && method === 'POST') {
      const created = simulation(SIMULATIONS[0].simulationId)!
      return ok({ ...created, faceModelId: b, title: '새 시안', hasChanges: false }, 201)
    }
    // 편집실 `원본 사진` 탭(S15P31B204-770)을 볼 수 있게 정면 사진 자리에 합성 기본 모델 썸네일을 준다(실제 얼굴 아님)
    if (c === 'front-photo')
      return ok({
        url: `${ASSET_BASE_URL}/models/base-female.webp`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      })
    if (method === 'PATCH') {
      const title = bodyTitle(body) ?? titleOf(b, found.summary.title)
      saveTitle(b, title)
      return ok({ faceModelId: b, title, updatedAt: daysAgo(0) })
    }
    if (method === 'DELETE') return ok({ faceModelId: b })
    return ok(faceModelDetail(b))
  }

  if (a === 'simulations') {
    if (!b)
      return ok(
        page(
          SIMULATIONS.map((item) => ({
            ...item,
            title: titleOf(item.simulationId, item.title),
          })),
        ),
      )
    const sim = simulation(b)
    if (!sim) return fail(404, 'EDIT_001')
    if (!c && method === 'PATCH') {
      const title = bodyTitle(body) ?? sim.title
      saveTitle(b, title)
      return ok({ simulationId: b, title, updatedAt: daysAgo(0) })
    }
    if (!c) return ok(sim)
    // AI 상담 화면을 볼 수 있게 예시 대화(합성 문구)를 돌려준다. 새로 보낸 말에는 고르기 질문으로 답한다
    if (c === 'messages') {
      if (method === 'GET') return ok(page(DEV_CONSULT))
      return ok({
        userMessage: { id: `dev-msg-${Date.now()}`, content: '', masked: false },
        assistantMessage: {
          id: `dev-msg-${Date.now() + 1}`,
          sender: 'AI 실장님',
          content: '어느 쪽으로 바꿔 볼까요?',
          intent: 'CLARIFY',
          filtered: false,
        },
        changeRequest: null,
        needsClarification: true,
        options: [
          { id: 'dev-opt-1', label: '조금만' },
          { id: 'dev-opt-2', label: '확실하게' },
        ],
        recommendedSliderCode: null,
        morphResult: null,
      })
    }
    // 편집 요청은 받은 상태를 그대로 돌려준다(저장은 하지 않는다)
    return ok({
      morphState: sim.morphState,
      stateVersion: sim.stateVersion + 1,
      currentSeq: sim.currentSeq + 1,
      canUndo: true,
      canRedo: false,
    })
  }

  if (a === 'notifications') return b === 'read' ? ok({ unreadCount: 0 }) : ok(NOTIFICATIONS)
  // 새 모델(QR 연결): 연결을 기다리는 상태로 둔다. 실제 촬영·업로드는 하지 않는다
  if (a === 'capture-links') {
    // 실서버와 같은 QR 유효 시간(link-ttl 180초). 만들 때 한 번 정하고, 상태 조회는 같은 만료 시각을 돌려준다
    if (!b && method === 'POST') {
      devLinkExpiresAt = new Date(Date.now() + DEV_QR_TTL_MS).toISOString()
      const qrUrl = `${window.location.origin}/m/capture#t=dev-preview-token`
      return ok({ linkId: 'dev-link-1', qrUrl, expiresAt: devLinkExpiresAt }, 201)
    }
    if (b && method === 'DELETE') return ok({})
    if (b) {
      const expiresAt = devLinkExpiresAt ?? new Date(Date.now() + DEV_QR_TTL_MS).toISOString()
      const status = Date.parse(expiresAt) <= Date.now() ? 'EXPIRED' : 'WAITING'
      return ok({ linkId: b, status, expiresAt, jobId: null })
    }
  }
  if (a === 'reconstructions') {
    if (b === 'current') return ok(null)
    if (b && !c) return ok(job(b))
    if (b && c === 'face-reading') return faceReadingReply(method, b)
  }
  if (a === 'face-readings' && b) return faceReadingStatus(b)

  return fail(404, 'DEV_MOCK_NOT_FOUND')
}

/** 가입 동의(SCR-02)를 개발 화면에서 열어 보려는 동의서 4종(합성 값, 전문 주소는 FE 법적 문서 경로) */
const DEV_CONSENT_DOCUMENTS = (
  [
    ['TERMS', 'terms'],
    ['PRIVACY', 'privacy'],
    ['FACE_DATA', 'face-data'],
    ['FACE_PUBLIC', 'face-public'],
  ] as const
).map(([consentType, slug]) => ({
  consentDocumentId: `dev-consent-${slug}`,
  consentType,
  version: '2026-10-v1',
  title: CONSENT_TITLES[consentType],
  contentUrl: `/legal/${slug}/2026-10-v1`,
  required: true,
  summary: null,
  effectiveAt: daysAgo(30),
}))

function guestReply(method: string, path: string): Reply {
  const capture = captureReply(method, path)
  if (capture) return capture
  if (path === '/morph-parameters') return ok(DEV_CATALOG)
  if (method === 'GET' && /^\/auth\/oauth\/[a-z]+\/authorize-url$/.test(path)) {
    // 카카오는 새 사용자처럼 콜백 → 가입 동의로, Google은 제공자 화면 대신 회원 보기로 바꿔 돌아온다
    if (path.includes('/kakao/'))
      return ok({
        authorizeUrl: '/oauth/kakao?code=dev-new-user&state=dev-state',
        state: 'dev-state',
      })
    return ok({ authorizeUrl: `/?${DEV_AUTH_QUERY}=member`, state: 'dev-state' })
  }
  if (method === 'POST' && path === '/auth/oauth/kakao/login') {
    return ok({
      isNewUser: true,
      signupToken: 'dev-signup',
      signupExpiresIn: 600,
      profile: { provider: 'KAKAO', nickname: '미리보기', maskedEmail: 'pr***@example.com' },
    })
  }
  if (method === 'GET' && path === '/consent-documents') return ok(DEV_CONSENT_DOCUMENTS)
  if (method === 'POST' && path === '/auth/signup') {
    // 가입을 마치면 다음 새로고침부터 회원 보기
    writeDevAuthMode('member')
    return ok(
      { accessToken: 'dev-member', expiresIn: 3600, user: { id: ME.id, nickname: ME.nickname } },
      201,
    )
  }
  return fail(401, 'AUTH_003')
}

/**
 * AI 관상(S15P31B204-440)을 개발 화면에서 끝까지 볼 수 있게 흉내 낸다(합성 결과, 실제 얼굴 없음).
 * 처음 조회는 404(아직 안 봄) → 'AI 관상 보기'를 누르면 PENDING → 3초 뒤 DONE. 사진은 기본 모델(합성) 그림으로 대신한다.
 * 새로고침하면 처음부터 다시 볼 수 있다(메모리에만 기억).
 */
const faceReadingRequested = new Map<string, number>()
const DEV_READING_RESULT = {
  title: '차분하고 단단한 인상',
  overall: '전체적으로 균형이 잡혀 있어 첫인상이 편안하고 믿음직하게 느껴지는 얼굴이에요.',
  parts: [
    { part: 'FOREHEAD', name: '이마', reading: '넓고 고른 이마라 생각이 깊어 보여요.' },
    { part: 'EYEBROWS', name: '눈썹', reading: '결이 차분해 부드러운 인상을 줘요.' },
    { part: 'EYES', name: '눈', reading: '눈매가 가지런해 집중력이 좋아 보여요.' },
    { part: 'NOSE', name: '코', reading: '콧대가 곧아 얼굴 중심이 또렷해요.' },
    { part: 'MOUTH', name: '입', reading: '입꼬리가 편안해 말투가 다정해 보여요.' },
    { part: 'CHIN', name: '턱', reading: '턱선이 안정적이라 꾸준한 인상을 줘요.' },
  ],
  advice: [
    { part: 'NOSE', change: '콧대를 조금 높이면', effect: '옆모습이 더 또렷해 보여요' },
    { part: 'EYEBROWS', change: '눈썹 끝을 살짝 올리면', effect: '생기 있는 인상이 돼요' },
  ],
}

function faceReading(jobId: string) {
  const at = faceReadingRequested.get(jobId) ?? Date.now()
  const done = Date.now() - at > 3000
  return {
    readingId: `dev-reading-${jobId}`,
    jobId,
    status: done ? 'DONE' : 'PENDING',
    result: done ? DEV_READING_RESULT : null,
    createdAt: new Date(at).toISOString(),
  }
}

function faceReadingReply(method: string, jobId: string): Reply {
  if (method === 'POST') {
    if (!faceReadingRequested.has(jobId)) faceReadingRequested.set(jobId, Date.now())
    return ok(faceReading(jobId))
  }
  return faceReadingRequested.has(jobId) ? ok(faceReading(jobId)) : fail(404, 'FR_001')
}

function faceReadingStatus(readingId: string): Reply {
  const jobId = readingId.replace(/^dev-reading-/, '')
  return faceReadingRequested.has(jobId) ? ok(faceReading(jobId)) : fail(404, 'FR_001')
}

function respond(reply: Reply): Response {
  const body =
    reply.error === undefined
      ? { success: true, data: reply.data ?? null, error: null }
      : {
          success: false,
          data: null,
          error: { code: reply.error, message: '개발용 가짜 응답', details: [] },
        }
  if (reply.status === 204) return new Response(null, { status: 204 })
  return new Response(JSON.stringify(body), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * 생성 중 → 실패 흐름 보기(개발용, 2026-11-01). 주소에 `?devFailRun`을 붙여 열면 그 시각부터 20초 동안 3D 생성이
 * 3단계 진행 중이다가 '얼굴을 찾지 못함'으로 실패한다. 진행 팝업 → 같은 자리의 실패 카드 → 실패 안내를 확인한다.
 * 시작 시각만 localStorage에 남겨 화면 이동·(주소에 표시가 없는) 새로고침에도 이어진다. 표시가 붙은 주소를 다시 열면
 * 새 작업으로 처음부터 시작한다.
 */
const DEV_FAIL_RUN_KEY = 'preface.devFailRun'
const DEV_FAIL_RUN_MS = 20_000

function failRunReply(path: string, query: URLSearchParams): Reply | null {
  let start = 0
  try {
    start = Number(window.localStorage.getItem(DEV_FAIL_RUN_KEY))
  } catch {
    return null
  }
  if (!(start > 0)) return null
  const jobId = `dev-job-fail-${start}`
  const failed = Date.now() - start >= DEV_FAIL_RUN_MS
  const at = new Date(start).toISOString()
  const job: ReconstructionJob = {
    jobId,
    queuePosition: null,
    createdAt: at,
    startedAt: at,
    ...(failed
      ? {
          status: 'FAILED',
          stage: 'QUALITY_CHECK',
          stageIndex: 2,
          failCodes: ['QUALITY_NO_FACE'],
          faceModelId: null,
          finishedAt: new Date(start + DEV_FAIL_RUN_MS).toISOString(),
        }
      : {
          status: 'RUNNING',
          stage: 'RECONSTRUCT',
          stageIndex: 3,
          failCodes: [],
          faceModelId: null,
          finishedAt: null,
        }),
  }
  if (path === '/reconstructions/current')
    return ok(!failed || query.get('includeRecentFailed') === 'true' ? job : null)
  if (path === `/reconstructions/${jobId}`) return ok(job)
  return null
}

let installed = false

/** `window.fetch`를 감싼다. API 주소로 가는 요청만 가짜로 답한다 */
export function installMockApi(mode: DevAuthMode): void {
  if (installed) return
  installed = true
  const realFetch = window.fetch.bind(window)
  const base = new URL(API_BASE_URL, window.location.href)
  if (new URLSearchParams(window.location.search).has('devFailRun')) {
    try {
      window.localStorage.setItem(DEV_FAIL_RUN_KEY, String(Date.now()))
    } catch {
      // 저장이 막히면 흐름 보기를 쓰지 않는다
    }
  }

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      return realFetch(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const path = url.pathname.slice(base.pathname.length) || '/'
    // 관상 사진은 그림 파일이라 기본 모델(합성) 정면 그림으로 대신 돌려준다
    if (/^\/reconstructions\/[^/]+\/face-reading\/photo$/.test(path))
      return realFetch(new URL('/models/base-female.webp', window.location.href))
    // 실제 네트워크처럼 아주 짧게 기다린다(로딩 상태가 한 번은 그려지게)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const failRun = mode === 'member' ? failRunReply(path, url.searchParams) : null
    if (failRun) return respond(failRun)
    let body: unknown = null
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    } catch {
      body = null
    }
    return respond(mode === 'member' ? memberReply(method, path, body) : guestReply(method, path))
  }
}
