// 앞모습·옆모습 얼굴 외곽선에 바뀌는 방향 화살표 하나(NoseIcon과 같은 선 굵기·크기).
const FRONT =
  'M6 3.5C6 9 6.4 12.5 8.4 15.3C9.6 17 10.8 18 12 18C13.2 18 14.4 17 15.6 15.3C17.6 12.5 18 9 18 3.5'
const PROFILE =
  'M8 2.5C9 4.5 9.2 6.5 8.6 8.2L10 9.6L8.8 10.6L9.8 12.4C9.6 14.6 10.6 16.2 13 16.6L16.5 14.5'
const PATHS: Record<string, string[]> = {
  // 광대: 광대 높이에서 양옆 안쪽으로
  cheekbone: [FRONT, 'M1 7.5H4.5M3 6L4.5 7.5L3 9M23 7.5H19.5M21 6L19.5 7.5L21 9'],
  // 턱끝 앞뒤: 옆모습 턱끝 앞 좌우 화살표
  chinProjection: [PROFILE, 'M12 19.5H17.5M13.5 18L12 19.5L13.5 21M16 18L17.5 19.5L16 21'],
  // 턱끝 길이: 앞모습 턱끝 아래 위아래 화살표
  chinLength: [FRONT, 'M12 14V20.5M10.5 15.5L12 14L13.5 15.5M10.5 19L12 20.5L13.5 19'],
  // 턱끝 폭: 앞모습 턱끝 양옆
  chinWidth: [FRONT, 'M5.5 18.5H9M7.5 17L9 18.5L7.5 20M18.5 18.5H15M16.5 17L15 18.5L16.5 20'],
  // 볼살: 볼 아래에서 안쪽으로
  cheekVolume: [FRONT, 'M2.5 12H6M4.5 10.5L6 12L4.5 13.5M21.5 12H18M19.5 10.5L18 12L19.5 13.5'],
  // 사각턱: 턱 모서리에서 안쪽·위로
  jawAngle: [FRONT, 'M3 18L6.5 14.5M4 14.5H6.5V17M21 18L17.5 14.5M20 14.5H17.5V17'],
}

/** 윤곽 슬라이더 줄 앞 작은 아이콘(무엇이 어느 방향으로 바뀌는지) */
export function ContourIcon({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 24 21"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(PATHS[id] ?? [FRONT]).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
