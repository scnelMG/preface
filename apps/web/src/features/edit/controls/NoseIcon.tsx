import type { NoseControlId } from '../noseControls'

// 옆모습(오른쪽을 봄)·앞모습 코에 바뀌는 방향 화살표 하나. 1.4px 선, 둥근 끝.
const PROFILE = 'M7 2.5C7.6 7 9.5 10.5 14 14.6C14.8 15.4 14.3 16.6 13.2 16.6H9.5'
const FRONT =
  'M10 3.5V11C7.6 12 6.4 14.4 7.6 16.3C8.6 17.6 10.6 17.2 12 16.4C13.4 17.2 15.4 17.6 16.4 16.3C17.6 14.4 16.4 12 14 11V3.5'
const PATHS: Record<NoseControlId, string[]> = {
  // 콧대: 콧등에서 바깥(위·앞)으로
  bridge: [PROFILE, 'M12 7.5L16.5 3M13.5 3H16.5V6M12 4.5V7.5H15'],
  // 코끝 앞뒤: 코끝 앞에 좌우 화살표
  projection: [PROFILE, 'M17 15H22.5M18.5 13.5L17 15L18.5 16.5M21 13.5L22.5 15L21 16.5'],
  // 코끝 위아래: 코끝 옆에 위아래 화살표
  lower: [PROFILE, 'M19 10V20M17.5 11.5L19 10L20.5 11.5M17.5 18.5L19 20L20.5 18.5'],
  // 콧볼: 앞모습 콧볼 양옆 바깥으로
  alar: [FRONT, 'M1 14.5H4.5M2.5 13L1 14.5L2.5 16M23 14.5H19.5M21.5 13L23 14.5L21.5 16'],
}

/** 코 슬라이더 줄 앞 작은 아이콘(무엇이 어느 방향으로 바뀌는지) */
export function NoseIcon({ id }: { id: NoseControlId }) {
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
      {PATHS[id].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
