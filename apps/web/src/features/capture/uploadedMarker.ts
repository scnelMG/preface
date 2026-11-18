/**
 * 이 탭에서 업로드를 마쳤다는 표시. 업로드 완료 화면(SCR-17④)에서 새로고침해도
 * "QR을 다시 스캔해 주세요" 대신 완료 화면을 다시 보여 주려고 둔다.
 *
 * sessionStorage(탭 단위)에 시각을 둔다. 토큰은 넣지 않는다.
 * 같은 기기 촬영(-457)이면 3D 생성 화면으로 다시 갈 수 있게 복원 작업 ID도 둔다(S15P31B204-524).
 * 작업 ID는 로그인한 본인만 볼 수 있다(남의 작업은 404). QR로 연결한 남의 휴대폰에는 두지 않는다.
 * 업로드 전용 세션 길이(30분)가 지나면 무시한다. 저장소를 못 쓰면(사생활 보호 모드 등) 조용히 넘어간다.
 */
const KEY = 'preface.capture.uploadedAt'
const VALID_MS = 30 * 60 * 1000

/** 복원한 업로드 표시. `jobId`는 같은 기기에서 올렸을 때만 있다 */
export interface UploadedMark {
  jobId: string | null
}

export function rememberUploaded(now = Date.now(), jobId: string | null = null) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ at: now, jobId }))
  } catch {
    // 표시는 편의 기능이다. 못 남겨도 흐름은 그대로다
  }
}

export function forgetUploaded() {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // 위와 같다
  }
}

/** 30분 안에 이 탭에서 올렸으면 표시를, 아니면 null을 준다. 시각만 있던 예전 값도 읽는다 */
export function readUploaded(now = Date.now()): UploadedMark | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    const at = typeof parsed === 'number' ? parsed : Number((parsed as { at?: unknown } | null)?.at)
    if (!Number.isFinite(at) || at <= 0 || now - at >= VALID_MS) return null
    const jobId = typeof parsed === 'object' ? (parsed as { jobId?: unknown } | null)?.jobId : null
    return { jobId: typeof jobId === 'string' && jobId ? jobId : null }
  } catch {
    return null
  }
}
