import { cx } from '@/shared/ui'
import { CAPTURE_SEQUENCE } from './guideContent'

/**
 * 촬영 순서 예시 GIF(`CAPTURE_SEQUENCE`). PC 가이드 모달(P3-51)과 휴대폰 가이드(SCR-05)가 같이 쓴다.
 *
 * GIF는 이미지 최적화가 움직임을 없애므로 `next/image` 대신 원본을 그대로 쓴다.
 * 움직임 줄이기 설정이면 첫 장면(정면) 그림을 고른다.
 */
export function CaptureSequenceImage({ className }: { className?: string }) {
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={CAPTURE_SEQUENCE.still} />
      <img
        src={CAPTURE_SEQUENCE.gif}
        alt={CAPTURE_SEQUENCE.alt}
        width={CAPTURE_SEQUENCE.width}
        height={CAPTURE_SEQUENCE.height}
        // 크기를 넘기지 않으면 칸 너비에 맞춘다(cx는 클래스를 합치지 않으므로 너비 클래스를 겹치지 않게 고른다)
        className={cx('block h-auto', className ?? 'w-full')}
      />
    </picture>
  )
}
