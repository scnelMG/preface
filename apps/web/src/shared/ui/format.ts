/**
 * 슬라이더 가중치를 화면 표시용 퍼센트로 바꾼다. 0.2 → "+20%", 0 → "0%", -0.1 → "-10%".
 * 명세서 REQ-N-18(화면 % = weight × 100), Wireframe v3.2 "직접 조절: 값 %".
 *
 * 'use client' 파일에 두지 않는다. 서버 컴포넌트에서 가져오면 호출할 수 없는 참조가 되기 때문이다.
 */
export function formatPercent(weight: number): string {
  const percent = Math.round(weight * 100)
  return percent > 0 ? `+${percent}%` : `${percent}%`
}
