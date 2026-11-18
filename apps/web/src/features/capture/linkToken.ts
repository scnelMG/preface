/**
 * QR 연결 토큰은 URL fragment에 실린다: `https://{host}/m/capture#t={token}` (API-QR-01).
 * fragment는 서버·프록시 로그에 남지 않는다(REQ-N-21). 그래서 브라우저에서만 읽을 수 있다.
 *
 * 읽자마자 주소창에서 지운다(API-QR-02 비고). 남겨 두면 새로고침할 때 같은 토큰을 다시 교환해
 * `QR_002`를 받고, 방문 기록·공유로 토큰이 새어 나간다.
 */

const TOKEN_KEY = 't'
/** 휴대폰에서 바로 시작했다(QR 없이 같은 기기, S15P31B204-457). fragment라 서버에 가지 않는다 */
const SAME_DEVICE_KEY = 'self'
/** 촬영 화면 디버그 수치(-716). PC 주소가 `?debug=1`이면 QR fragment에 실어 휴대폰에서 주소를 고치지 않게 한다 */
const DEBUG_KEY = 'debug'

/** `#t=…`에서 토큰을 꺼낸다. 없거나 비었으면 null */
export function parseLinkToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const token = new URLSearchParams(raw).get(TOKEN_KEY)
  return token ? token : null
}

/** `#t=…&self=1`이면 true */
export function parseSameDevice(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return new URLSearchParams(raw).get(SAME_DEVICE_KEY) === '1'
}

/**
 * 같은 기기에서 바로 열 촬영 주소. 서버가 준 QR 주소의 경로·토큰만 쓰고 지금 사이트 주소에 붙인다
 * (QR 주소의 호스트가 지금 접속한 곳과 달라도 로그인 쿠키가 있는 같은 사이트로 돌아오게).
 */
export function sameDeviceCaptureUrl(qrUrl: string, origin: string): string {
  const url = new URL(qrUrl)
  return `${origin}${url.pathname}${url.hash}&${SAME_DEVICE_KEY}=1`
}

/** 주소창의 fragment를 지운다. 방문 기록을 새로 쌓지 않는다(replaceState) */
export function clearLinkTokenFromUrl(): void {
  const { pathname, search, hash } = window.location
  if (!hash) return
  window.history.replaceState(window.history.state, '', `${pathname}${search}`)
}

/**
 * 주소창에서 토큰과 같은 기기 표시를 읽고 바로 지운다.
 * fragment에 `debug=1`이 있으면 쿼리 `?debug=1`로 옮긴다(촬영 화면이 쿼리를 읽고, 새로고침해도 남는다).
 */
export function takeLinkFromUrl(): { token: string | null; sameDevice: boolean } {
  const { hash } = window.location
  clearLinkTokenFromUrl()
  if (fragmentParams(hash).get(DEBUG_KEY) === '1') {
    const { pathname, search } = window.location
    const query = new URLSearchParams(search)
    query.set(DEBUG_KEY, '1')
    window.history.replaceState(window.history.state, '', `${pathname}?${query}`)
  }
  return { token: parseLinkToken(hash), sameDevice: parseSameDevice(hash) }
}

/** PC 화면 주소(`pageSearch`)가 `?debug=1`이면 QR 주소 fragment에 `debug=1`을 붙인다. 아니면 그대로 */
export function qrUrlForPage(qrUrl: string, pageSearch: string): string {
  if (new URLSearchParams(pageSearch).get(DEBUG_KEY) !== '1') return qrUrl
  return `${qrUrl}&${DEBUG_KEY}=1`
}

function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
}

/** 페이지를 새로 불러오며 이동한다. 같은 기기 촬영 시작·끝에서 쓴다(새로 불러와야 세션이 맞게 바뀐다) */
export function openPage(url: string): void {
  window.location.assign(url)
}

/**
 * 지금 페이지를 방문 기록에서 빼고 새로 불러오며 이동한다(`location.replace`).
 * 같은 기기 업로드를 마치고 3D 생성 화면으로 갈 때 쓴다. 뒤로 가기를 눌러도 끝난 촬영 화면으로 돌아오지 않는다
 * (돌아오면 스토어가 처음 상태라 버튼 없는 완료 화면이 보였다, S15P31B204-524).
 * 새로 불러와야 AuthBootstrap이 로그인 쿠키로 내 세션을 다시 연다.
 */
export function replacePage(url: string): void {
  window.location.replace(url)
}
