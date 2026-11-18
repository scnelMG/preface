/**
 * 공유 링크가 닫히는 시각 문구(S15P31B204-841). 서비스 시간대(Asia/Seoul) 기준으로 "11월 21일 오후 3시"처럼 짧게 쓴다.
 * 분이 0이 아니면 "오후 3시 30분"으로 붙이고, 올해가 아니면 앞에 연도를 붙인다. 읽을 수 없는 시각이면 null이다.
 */
const PARTS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: true,
})

function seoulParts(date: Date) {
  const parts = PARTS.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    period: get('dayPeriod'),
    hour: get('hour'),
    minute: Number(get('minute')),
  }
}

export function formatShareExpiry(iso: string, now: Date = new Date()): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const at = seoulParts(date)
  const year = at.year === seoulParts(now).year ? '' : `${at.year}년 `
  const minute = at.minute ? ` ${at.minute}분` : ''
  return `${year}${at.month}월 ${at.day}일 ${at.period} ${at.hour}시${minute}`
}
