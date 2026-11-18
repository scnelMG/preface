import { useMemo } from 'react'
import { encode } from 'uqr'

/**
 * 문자열을 QR 그림(SVG)으로 그린다. 서버에 보내지 않고 브라우저에서 만든다.
 *
 * `value`에는 QR 토큰이 들어 있다. 그래서 접근성 이름에도 주소를 넣지 않는다(`label`만 읽힌다).
 * 검은 칸을 한 path로 묶어 DOM 노드를 줄인다.
 */
export function QrCode({
  value,
  size = 160,
  label = 'QR 코드',
  className,
}: {
  value: string
  size?: number
  label?: string
  className?: string
}) {
  const { path, count } = useMemo(() => {
    // 휴대폰 화면·인쇄 반사에도 읽히게 오류 정정 M. 바깥 여백은 카드 안쪽 여백이 맡는다
    const qr = encode(value, { ecc: 'M', border: 0 })
    let d = ''
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      })
    })
    return { path: d, count: qr.size }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
