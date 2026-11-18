'use client'
import { ControlGroup, ControlStack } from '../controls/ControlGroup'
import { HAIR_ASSETS, HAIR_NONE } from './catalog'

/**
 * 실험실 헤어 탭(S15P31B204-699, FN-HAIR-01). 헤어 하나를 썸네일 카드로 고른다(S15P31B204-712).
 * 고른 카드를 다시 누르면 벗긴다(없음). 칸이 따로 없다.
 * 로그인 편집실(SimulationLab)과 체험(메인 MainStudio·체험 실험실 GuestLab)이 같이 쓴다. 부위 탭에 붙이던 `베타`는
 * 뗐다(S15P31B204-770에서 붙임, S15P31B204-838에서 뗌).
 *
 * 헤어 선택은 되돌리기 이력에 넣지 않는다(FN-HAIR-01 수용 3). 그래서 저장·커밋 없이 고르는 즉시 바깥 상태만 바꾼다.
 * 카드는 켜고 끄는 버튼(aria-pressed)이다. 라디오는 다시 눌러 끌 수 없어서 쓰지 않는다.
 */
export function HairPanel({
  value,
  onChange,
  disabled,
  loading,
  compact,
}: {
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  /** 고른 헤어 파일을 불러오는 중 */
  loading?: boolean
  /** 세 칸 작은 카드(메인 체험의 좁은 조절 카드) */
  compact?: boolean
}) {
  return (
    <ControlStack>
      <ControlGroup title="헤어" index={0}>
        <div
          role="group"
          aria-label="헤어 스타일"
          className="cc-hair-grid"
          data-density={compact ? 'compact' : undefined}
        >
          {HAIR_ASSETS.map((asset) => {
            const on = value === asset.id
            return (
              <button
                key={asset.id}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onChange(on ? HAIR_NONE : asset.id)}
                className="cc-hair-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 미리 만든 작은 webp를 그대로 쓴다(ASSET_BASE_URL이 CDN일 수 있다) */}
                <img
                  src={asset.thumbnail}
                  alt=""
                  width={240}
                  height={240}
                  loading="lazy"
                  decoding="async"
                />
                {asset.label}
              </button>
            )
          })}
        </div>
        <p role="status" className="type-caption text-muted-soft">
          {loading
            ? '헤어를 불러오는 중이에요.'
            : value === HAIR_NONE
              ? '헤어를 고르면 3D 모델에 씌워 볼 수 있어요. 다시 누르면 벗겨요.'
              : '평균 머리 모양에 맞춘 헤어라 얼굴에 따라 조금 뜨거나 파묻혀 보일 수 있어요.'}
        </p>
      </ControlGroup>
    </ControlStack>
  )
}
