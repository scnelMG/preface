import { cx } from '@/shared/ui'

/**
 * 둥근 아이콘 버튼(원본 보기, 표정 트래킹). 아이콘만 있으므로 쓰는 쪽이 `aria-label`과 말풍선(Tooltip)을 단다.
 * - 도구 줄에서는 바탕 없이 아이콘만 보인다.
 * - 3D 무대 위(`onStage`)에서는 옅은 바탕을 깐다: 원이 무대 가장자리에서 조명 구와 같은 거리에 놓여 정렬이 맞고,
 *   모델 위를 지나가도 버튼으로 보인다.
 * - 켜진 상태(`on`)는 검은 바탕이다. `aria-pressed`와 함께 쓴다.
 * 바탕·글자색 클래스는 상태마다 하나씩만 붙여 서로 겹치지 않게 한다.
 */
export function toolButton({ on = false, onStage = false } = {}): string {
  return cx(
    'inline-flex size-10 items-center justify-center rounded-full transition-[background-color,color,transform] duration-(--pf-dur-ui) ease-(--pf-ease-out) active:scale-95',
    on
      ? 'bg-ink text-on-ink'
      : onStage
        ? 'bg-ink/5 text-ink hover:bg-ink/10'
        : 'text-ink hover:bg-ink/5',
  )
}
