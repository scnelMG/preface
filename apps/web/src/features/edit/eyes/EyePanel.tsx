'use client'
import { ControlGroup, ControlStack } from '../controls/ControlGroup'
import { RulerFader } from '../controls/RulerFader'
import { Segmented } from '../controls/Segmented'
import { CommitOnRelease } from '../controls/CommitOnRelease'
import { LidGlyph } from './LidGlyph'
import {
  changeEyes,
  controlLimit,
  EYE_DEFAULTS,
  eyesIn,
  type EyeAction,
  type EyeControl,
  type EyeLimits,
  type EyeReview,
  type EyeSelection,
  type EyeSide,
  type EyeState,
  type EyeStyle,
} from './state'

const STYLES = [
  { value: 'none', label: '없음' },
  { value: 'inline', label: '인라인' },
  { value: 'inout', label: '인아웃' },
  { value: 'outline', label: '아웃라인' },
] as const
const TRIMS = [
  { value: 'inner', label: '앞트임' },
  { value: 'outer', label: '뒤트임' },
  { value: 'upper', label: '윗트임' },
  { value: 'lower', label: '밑트임' },
] as const

/**
 * 눈 슬라이더 간격(엔진 단위). 1이면 한계가 작은 조절(윗트임 40 등)은 줄 전체가 40칸이라 끌 때 칸마다 끊겨 보였다.
 * 0.5면 100 단위가 200칸으로, 코 슬라이더(-1~1, 0.01)와 같은 촘촘함이다(-526).
 */
export const EYE_SLIDER_STEP = 0.5

const share = (value: number, max: number) => (max <= 0 ? 0 : Math.round((value / max) * 100))

/**
 * 모델 선택·저장·서버 API를 소유하지 않는 눈 조절부. 코와 같은 묶음 + 아이콘 달린 슬라이더 줄만 쓴다.
 * 쌍꺼풀은 모양 고르기 줄 + 높이(깊이는 기본값 고정, 구간 높이는 막음), 트임은 방향마다 한 줄. 슬라이더 끝은 그 모델의 안전 한계다
 * (eye-edit.mjs `measureEyeSafeLimit`). 적용할 눈(selection)은 바깥에서 정한다.
 */
export function EyePanel({
  state,
  selection,
  review,
  limits,
  onPreview,
  onCommit,
  onSelectControl,
  recommendedCode,
  disabled,
}: {
  state: EyeState
  selection: EyeSelection
  review: EyeReview
  /** 없으면 한계를 계산하지 않는 환경으로 보고 전체 범위를 쓴다 */
  limits?: EyeLimits
  onPreview: (state: EyeState) => void
  onCommit: () => void
  onSelectControl?: (code: string, label: string) => void
  recommendedCode?: string | null
  disabled?: boolean
}) {
  const sides = eyesIn(selection)
  const foldSides = sides.filter((side) => review[side] === 'absent')
  const allowed = foldSides.length > 0
  // 쌍꺼풀 값은 생성 가능한 눈을 기준으로, 트임 값은 고른 눈 전체를 기준으로 보여 준다.
  const fold = state[(allowed ? foldSides : sides)[0]]
  function act(action: EyeAction, save = true) {
    onPreview(changeEyes(state, selection, action, { review, limits }))
    if (save) onCommit()
  }

  function slider(control: EyeControl, label: string, shown: EyeSide[]) {
    const anchor = shown[0]
    const eye = state[anchor]
    const limit = controlLimit(limits, control, eye.style)
    const checking = limit === undefined
    const locked = limit === 0
    const max = limit ?? 100
    const read = (side: EyeSide) => Math.min(state[side].values[control], max)
    const differs = shown.length > 1 && shown.some((side) => read(side) !== read(anchor))
    return (
      <RulerFader
        key={control}
        code={`eye.${control}`}
        recommended={recommendedCode === `eye.${control}`}
        icon={
          <LidGlyph
            mark={control === 'crease' ? 'depth' : control}
            style={
              eye.enabled && (control === 'height' || control === 'crease') ? eye.style : undefined
            }
          />
        }
        label={label}
        value={read(anchor)}
        defaultValue={Math.min(EYE_DEFAULTS[control], max)}
        min={0}
        max={locked ? 1 : max}
        step={EYE_SLIDER_STEP}
        disabled={disabled || checking || locked}
        changed={eye.values[control] !== EYE_DEFAULTS[control]}
        formatValue={() =>
          checking
            ? '확인 중'
            : locked
              ? '잠김'
              : differs
                ? `L ${share(read('R'), max)}% · R ${share(read('L'), max)}%`
                : `${share(read(anchor), max)}%`
        }
        onChange={(value) =>
          act({ type: 'control', control, value, relativeTo: differs ? anchor : undefined }, false)
        }
        onSelect={
          onSelectControl &&
          (() => onSelectControl(`eye.${control}`, control === 'height' ? '쌍꺼풀 높이' : label))
        }
      />
    )
  }

  const style = allowed && fold.enabled ? fold.style : 'none'

  return (
    <CommitOnRelease onCommit={onCommit} disabled={disabled}>
      <ControlStack>
        <ControlGroup title="쌍꺼풀" index={0}>
          <Segmented
            label="쌍꺼풀 모양"
            value={style}
            disabled={disabled}
            options={STYLES.map((item) => ({
              ...item,
              disabled:
                item.value !== 'none' &&
                (!allowed || (controlLimit(limits, 'height', item.value as EyeStyle) ?? 0) <= 0),
              glyph: <LidGlyph style={item.value === 'none' ? undefined : item.value} />,
            }))}
            onChange={(value) =>
              value === 'none'
                ? act({ type: 'enabled', enabled: false })
                : act({ type: 'style', style: value as EyeStyle })
            }
          />
          {!allowed ? (
            <p role="status" className="type-caption text-muted-soft">
              {sides.some((side) => review[side] === 'unknown')
                ? '이 모델은 쌍꺼풀 확인 전이라 라인을 만들 수 없어요.'
                : '쌍꺼풀이 이미 있는 눈은 라인을 새로 만들지 않아요.'}
            </p>
          ) : fold.enabled ? (
            // 깊이는 화면에서 조절하지 않고 기본값(엔진 FOLD_DEFAULT)으로 둔다(2026-11-01 개발 버전 결정: 높이만 제공)
            slider('height', '높이', foldSides)
          ) : null}
        </ControlGroup>

        <ControlGroup title="트임" index={1}>
          {TRIMS.map((item) => slider(item.value, item.label, sides))}
        </ControlGroup>
      </ControlStack>
    </CommitOnRelease>
  )
}
