import { cx, Icon, type IconName } from '@/shared/ui'

/**
 * 3D 조작 안내. 아이콘 + 어떻게 하는지를 짧은 문구로 보인다.
 *
 * 2026-10-30에는 아이콘 + 한 단어(회전 · 확대 · 이동)만 보이고 방법은 읽기 프로그램 문구로만 전했다.
 * 오른쪽 버튼으로 끌어 이동하는 방법을 사용자가 찾지 못해, 방법을 화면에 보이도록 바꿨다(S15P31B204-533).
 * 툴팁은 여전히 쓰지 않는다.
 *
 * 마우스(PC)와 터치(휴대폰·태블릿)는 문구가 다르다. 서버 렌더링에서 깜빡이지 않도록 두 목록을 모두 그리고
 * `(pointer: coarse)` 미디어 쿼리로 하나만 보인다. 숨긴 목록은 display:none이라 읽기 프로그램도 한 번만 읽는다.
 * 문구는 FaceViewer 조작과 맞춘다: 마우스 왼쪽 회전·휠 확대·오른쪽 이동, 터치 한 손가락 회전·두 손가락 확대·이동.
 *
 * 참고용 고지는 여기 두지 않는다. 메인은 주 버튼 아래, 편집실은 이 줄 아래에 문장으로 둔다.
 */
type Hint = { icon: IconName; label: string }

export const MOUSE_HINTS: Hint[] = [
  { icon: 'ArrowsClockwise', label: '드래그 회전' },
  { icon: 'MagnifyingGlassPlus', label: '스크롤 확대' },
  { icon: 'ArrowsOutCardinal', label: '오른쪽 버튼으로 끌어 이동' },
]

export const TOUCH_HINTS: Hint[] = [
  { icon: 'ArrowsClockwise', label: '한 손가락 회전' },
  { icon: 'ArrowsOutCardinal', label: '두 손가락 확대·이동' },
]

function HintList({ hints, className }: { hints: Hint[]; className: string }) {
  return (
    <ul
      aria-label="3D 조작 안내"
      className={cx('items-center justify-center gap-x-(--space-12) gap-y-(--space-4)', className)}
    >
      {hints.map((hint) => (
        <li key={hint.label} className="inline-flex items-center gap-(--space-4) whitespace-nowrap">
          <Icon name={hint.icon} size={14} className="text-faint" />
          <span>{hint.label}</span>
        </li>
      ))}
    </ul>
  )
}

export function ViewerHints({ className }: { className?: string }) {
  return (
    <div className={cx('type-caption flex justify-center text-muted-soft', className)}>
      <HintList hints={MOUSE_HINTS} className="flex flex-wrap pointer-coarse:hidden" />
      <HintList hints={TOUCH_HINTS} className="hidden flex-wrap pointer-coarse:flex" />
    </div>
  )
}

/** 기능명세 R-01 결과 화면 고지. 문장 그대로 보인다 */
export const SIMULATION_NOTICE = '참고용 시뮬레이션이라 실제 결과와 다를 수 있어요.'
