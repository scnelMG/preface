/**
 * 음성 안내 켜짐(S15P31B204-765). 촬영에 익숙한 사람은 끄고 찍는다. 이 휴대폰 브라우저에만 기억한다.
 * 사생활 보호 모드 등으로 저장소를 못 쓰면 켜짐으로 본다(처음 쓰는 사람에게 안내가 빠지지 않게).
 */
const KEY = 'pf-capture-voice'

export function readVoiceOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeVoiceOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // 기억하지 못해도 이번 촬영에는 적용된다
  }
}
