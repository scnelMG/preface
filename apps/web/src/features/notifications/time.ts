/**
 * 알림 시간 표시(2026-10-31). 목록에서는 짧게(방금·5분 전·3시간 전·어제·4일 전·10월 21일), 정확한 시각은 title로 둔다.
 * 날짜 경계는 서비스 시간대(Asia/Seoul) 기준이다.
 */

const ZONE = 'Asia/Seoul'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Asia/Seoul 달력 날짜(일 단위 번호). 두 시각이 며칠 떨어졌는지 셀 때 쓴다 */
function seoulDay(date: Date): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-')
    .map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / (24 * HOUR))
}

function seoulParts(date: Date) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** 며칠 전인지(오늘 0, 어제 1). 미래 시각은 0으로 본다 */
export function daysAgo(iso: string, now: Date = new Date()): number {
  return Math.max(0, seoulDay(now) - seoulDay(new Date(iso)))
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const diff = Math.max(0, now.getTime() - date.getTime())
  const days = daysAgo(iso, now)
  if (diff < MINUTE) return '방금'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`
  if (days === 0) return `${Math.floor(diff / HOUR)}시간 전`
  if (days === 1) return '어제'
  if (days < 7) return `${days}일 전`
  const then = seoulParts(date)
  if (then.year === seoulParts(now).year) return `${then.month}월 ${then.day}일`
  return `${then.year}.${then.month}.${then.day}`
}

export type NotificationGroup = '오늘' | '어제' | '지난 7일' | '이전'

export function groupOf(iso: string, now: Date = new Date()): NotificationGroup {
  const days = daysAgo(iso, now)
  if (days === 0) return '오늘'
  if (days === 1) return '어제'
  if (days < 7) return '지난 7일'
  return '이전'
}
