import type { CaptureTrace } from '@/features/live-capture/captureTrace'
import { create } from 'zustand'
import { useAuthStore } from '@/features/auth/store'
import { disconnectCaptureLink, exchangeCaptureToken } from './api'
import { detectCaptureDevice, readDeviceModel, type CaptureDevice } from './device'
import { endReasonFromError, type CaptureEndReason } from './endReason'
import type { CaptureExchangeResult } from './types'
import { forgetUploaded, rememberUploaded, type UploadedMark } from './uploadedMarker'

/**
 * 휴대폰 업로드 전용 세션 흐름 (FN-CAP-04, 와이어프레임 v3.2 SCR-17).
 *
 *   connecting ─ 토큰 교환 성공 ─→ confirm(SCR-17①) ─ 계속 ─→ guide(SCR-05)
 *     ─ 촬영하기 ─→ recording(웹 녹화, -619) ─ 녹화 끝 ─→ review(SCR-07) ─ 업로드·완료 통지 ─→ uploaded(SCR-17④)
 *     (업로드는 웹 녹화로만 한다(-929). review의 다시 찍기 → recording)
 *        │                              │
 *        │ 네트워크 실패                 └ 내 계정이 아니에요 ─→ ended(disconnected)
 *        ↓
 *   connect-failed ─ 다시 시도 ─→ connecting
 *        │
 *        └ QR_001·QR_002·AUTH_023 ─→ ended
 *
 * 세션 토큰은 이 스토어에 두지 않는다. `shared/api/tokenStore`(메모리)에 scope=capture로 넣는다.
 * 새로고침하면 토큰이 사라진다. refresh가 없으므로 그때는 QR을 다시 스캔해야 한다.
 */
export type CaptureStep =
  | 'connecting'
  | 'connect-failed'
  | 'confirm'
  | 'guide'
  | 'recording'
  | 'review'
  | 'uploaded'
  | 'ended'

interface CaptureSessionState {
  step: CaptureStep
  linkId: string | null
  user: CaptureExchangeResult['user'] | null
  /** 세션 유효 시간(초) */
  expiresIn: number | null
  endReason: CaptureEndReason | null
  /** "내 계정이 아니에요" 처리 중 */
  isDisconnecting: boolean
  /** 웹 녹화 결과. 압축·변환하지 않는다 */
  video: File | null
  /** 웹 녹화 촬영 기록(-641). 업로드 요청에 함께 보낸다 */
  captureTrace: CaptureTrace | null
  /** 영상을 바꿀 때마다 1씩 오른다. 확인 화면을 새로 그리는 key로 쓴다 */
  videoKey: number
  /** 업로드 완료 통지(API-REC-01)로 만든 복원 작업 */
  jobId: string | null
  /**
   * 연결 확인 화면에서 고른 휴대폰 종류. 연결되면 브라우저 정보로 기본값을 넣는다.
   * 아이폰이면 기종을 사용자가 고른다(`device.ts`)
   */
  device: CaptureDevice
  /**
   * 기종(-619). 안드로이드는 연결 때 브라우저 정보로 읽고, 아이폰은 사용자가 고른다. 모르면 null.
   * 업로드 요청에 실려 추출 워커 렌즈 표의 출발값이 된다
   */
  deviceModel: string | null
  /**
   * 휴대폰에서 머리 추가를 눌러 QR 없이 바로 왔다(S15P31B204-457). 계정 확인 단계를 건너뛰고,
   * 업로드 뒤에는 PC 대신 이 기기에서 3D 생성 화면으로 간다.
   */
  sameDevice: boolean
  /**
   * 촬영 준비 시트에서 소리를 들어 보고 "잘 들려요"를 체크했다(S15P31B204-882).
   * 녹화 화면은 촬영 안내로 돌아가면 사라지므로, 다시 들어와도 체크가 남게 여기에 둔다
   */
  soundChecked: boolean

  /** QR 토큰을 교환한다. 네트워크 실패 때만 같은 토큰으로 retry()할 수 있다 */
  connect: (token: string, options?: { sameDevice?: boolean }) => Promise<void>
  retry: () => Promise<void>
  /** SCR-17① 휴대폰 종류를 고른다 */
  setDevice: (device: CaptureDevice) => void
  /** 기종을 고른다. 연결 확인·촬영 가이드에서만(같은 기기 흐름은 확인 화면이 없다) */
  setDeviceModel: (model: string | null) => void
  /** "잘 들려요" 체크를 기억한다 */
  setSoundChecked: (checked: boolean) => void
  /** SCR-17① 계속 → 촬영 가이드 */
  continueToGuide: () => void
  /** 촬영 가이드·다시 찍기 → 웹 녹화 화면 */
  startRecording: () => void
  /** 녹화 화면에서 돌아간다 → 촬영 가이드 */
  cancelRecording: () => void
  /** 휴대폰에서 연결을 끊는다(API-QR-04) */
  disconnect: () => Promise<void>
  /** 웹 녹화 영상을 받았다 → SCR-07. 다시 찍으면 새 영상으로 바꾼다 */
  selectVideo: (file: File, trace?: CaptureTrace | null) => void
  /** 업로드와 완료 통지가 끝났다 → SCR-17④. 세션 토큰을 버린다 */
  markUploaded: (jobId: string) => void
  /**
   * 이 탭에서 이미 업로드를 마쳤다(완료 화면에서 새로고침·뒤로 가기) → SCR-17④.
   * 같은 기기에서 올렸으면 표시에 작업 ID가 있어 3D 생성 화면 버튼을 다시 보여 준다
   */
  restoreUploaded: (mark?: UploadedMark) => void
  /** 세션을 끝내고 이유를 보여 준다. 업로드 중 AUTH_023 등에서 부른다 */
  end: (reason: CaptureEndReason) => void
}

/**
 * 네트워크 실패 뒤 다시 시도할 토큰. 화면 상태에 두지 않으려고 모듈 변수로 둔다.
 * 성공하거나 서버가 거절하면 바로 비운다.
 */
let pendingToken: string | null = null

const INITIAL = {
  step: 'connecting' as CaptureStep,
  linkId: null,
  user: null,
  expiresIn: null,
  endReason: null,
  isDisconnecting: false,
  video: null as File | null,
  captureTrace: null as CaptureTrace | null,
  videoKey: 0,
  jobId: null as string | null,
  device: 'android' as CaptureDevice,
  deviceModel: null as string | null,
  sameDevice: false,
  soundChecked: false,
}

export const useCaptureSessionStore = create<CaptureSessionState>((set, get) => ({
  ...INITIAL,

  connect: async (token, options) => {
    const sameDevice = options?.sameDevice ?? get().sameDevice
    pendingToken = token
    // 새 QR로 들어왔다. 이전 업로드 표시는 지운다
    forgetUploaded()
    set({ ...INITIAL, step: 'connecting', sameDevice })
    try {
      const result = await exchangeCaptureToken(token)
      pendingToken = null
      useAuthStore.getState().startCaptureSession(result.captureSessionToken)
      const device = detectCaptureDevice()
      set({
        // 같은 기기면 내 계정인지 물을 필요가 없다. 기종은 브라우저 정보로 정한다
        step: sameDevice ? 'guide' : 'confirm',
        linkId: result.linkId,
        user: result.user,
        expiresIn: result.expiresIn,
        device,
      })
      // 안드로이드 기종은 브라우저가 알려 준다(아이폰은 사용자가 고른다). 기다리지 않는다
      if (device === 'android') fillAndroidModel(get, set)
    } catch (error) {
      const reason = endReasonFromError(error)
      if (reason === null) {
        set({ step: 'connect-failed' })
        return
      }
      pendingToken = null
      set({ step: 'ended', endReason: reason })
    }
  },

  retry: async () => {
    if (!pendingToken) {
      set({ step: 'ended', endReason: 'missing-token' })
      return
    }
    await get().connect(pendingToken)
  },

  setDevice: (device) => {
    if (get().step !== 'confirm' || get().device === device) return
    // 종류를 바꾸면 앞 종류로 정한 기종은 버린다(-882). "찍기 전에 확인해요"는 촬영 안내에 들어올 때마다 뜬다
    set({ device, deviceModel: null })
    if (device === 'android') fillAndroidModel(get, set)
  },

  setDeviceModel: (model) => {
    const { step } = get()
    if (step === 'confirm' || step === 'guide') set({ deviceModel: model })
  },

  setSoundChecked: (checked) => set({ soundChecked: checked }),

  continueToGuide: () => {
    if (get().step === 'confirm') set({ step: 'guide' })
  },

  startRecording: () => {
    const { step } = get()
    if (step === 'guide' || step === 'review') set({ step: 'recording' })
  },

  cancelRecording: () => {
    if (get().step === 'recording') set({ step: 'guide' })
  },

  selectVideo: (file, trace = null) => {
    const { step } = get()
    if (step === 'recording' || step === 'review')
      set({
        step: 'review',
        video: file,
        // 다시 찍으면 앞 녹화의 기록을 남기지 않는다
        captureTrace: trace,
        videoKey: get().videoKey + 1,
      })
  },

  markUploaded: (jobId) => {
    if (get().step !== 'review') return
    // 휴대폰이 할 일은 끝났다. 세션 토큰을 버린다(남은 30분 동안 다른 사람이 이 화면으로 API를 부르지 못하게).
    // QR-04(연결 끊기)는 부르지 않는다. 링크가 CANCELED가 되면 PC가 UPLOADED·jobId를 못 볼 수 있다.
    // 서버 세션은 30분 뒤 스스로 끝나고, 이미 만든 복원 작업은 영향받지 않는다.
    pendingToken = null
    useAuthStore.getState().signOut()
    // 같은 기기면 작업 ID도 남긴다. 다시 열려도 3D 생성 화면으로 가는 버튼을 보여 줄 수 있게(S15P31B204-524)
    rememberUploaded(Date.now(), get().sameDevice ? jobId : null)
    // 원본 파일 참조도 놓는다. jobId는 같은 기기면 3D 생성 화면으로 가는 데 쓴다
    set({ step: 'uploaded', jobId, video: null, captureTrace: null })
  },

  restoreUploaded: (mark) => {
    pendingToken = null
    const jobId = mark?.jobId ?? null
    // 작업 ID는 같은 기기에서 올렸을 때만 남는다. 있으면 같은 기기 완료 화면(3D 생성 화면 보기)을 그린다
    set({ ...INITIAL, step: 'uploaded', jobId, sameDevice: jobId !== null })
  },

  disconnect: async () => {
    const { linkId } = get()
    set({ isDisconnecting: true })
    try {
      if (linkId) await disconnectCaptureLink(linkId)
    } catch {
      // 이미 끊겼거나(AUTH_023) 통신이 안 돼도 휴대폰 쪽 세션은 버린다.
      // 남의 계정 세션을 계속 들고 있지 않는 게 우선이다. PC에서도 끊을 수 있다.
    }
    get().end('disconnected')
  },

  end: (reason) => {
    pendingToken = null
    useAuthStore.getState().signOut()
    set({ ...INITIAL, step: 'ended', endReason: reason })
  },
}))

/** 브라우저가 알려 주는 기종을 채운다. 그 사이 세션·종류가 바뀌었거나 이미 정했으면 두지 않는다 */
function fillAndroidModel(
  get: () => CaptureSessionState,
  set: (patch: Partial<CaptureSessionState>) => void,
) {
  const linkId = get().linkId
  void readDeviceModel().then((model) => {
    const now = get()
    if (model && now.linkId === linkId && now.device === 'android' && now.deviceModel === null)
      set({ deviceModel: model })
  })
}

/** 테스트용. 스토어와 모듈 상태를 처음으로 되돌린다 */
export function __resetCaptureSession() {
  pendingToken = null
  useCaptureSessionStore.setState(INITIAL)
}
