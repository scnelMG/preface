'use client'
import type { ReactNode } from 'react'
import { formatPercent } from '@/shared/ui/format'
import {
  noseControlChanges,
  noseRowLabel,
  type MorphValueChange,
  type NoseControlId,
  type PartControl,
} from '../noseControls'
import { ControlGroup, ControlStack } from './ControlGroup'
import { NoseIcon } from './NoseIcon'
import { RulerFader } from './RulerFader'

const NOSE_GROUPS = ['콧대', '코끝', '콧볼'] as const

/**
 * 부위 조절 묶음(코: 콧대·코끝·콧볼, 윤곽: 광대·턱끝·볼·턱선). 편집실과 메인 체험이 같이 쓴다.
 * 줄마다 data-control·data-code를 달아 바깥에서 슬라이더를 찾아 포커스하거나 시트 접힘 높이를 잴 수 있게 한다.
 * `groups`·`icon`을 주지 않으면 코 묶음·코 아이콘이다.
 */
export function NoseControlGroups({
  controls,
  onChange,
  onSelectControl,
  disabled,
  onlyCode,
  recommendedCode,
  rowClassName,
  groups = NOSE_GROUPS,
  icon = (id) => <NoseIcon id={id as NoseControlId} />,
  formatValue = formatPercent,
  formatAriaValue,
}: {
  controls: readonly PartControl[]
  onChange: (changes: readonly MorphValueChange[]) => void
  onSelectControl?: (code: string, label: string) => void
  disabled?: boolean
  onlyCode?: string
  recommendedCode?: string | null
  rowClassName?: string
  groups?: readonly string[]
  icon?: (id: string) => ReactNode
  formatValue?: (value: number) => string
  formatAriaValue?: (value: number) => string
}) {
  return (
    <ControlStack>
      {groups.map((name, index) => {
        const grouped = controls.filter((control) => control.group === name)
        if (!grouped.length) return null
        return (
          <ControlGroup key={name} title={name} index={index}>
            {grouped.map((control, row) => (
              <div
                key={control.id}
                className={rowClassName}
                data-control={control.id}
                data-code={control.effects[0].code}
              >
                <RulerFader
                  label={noseRowLabel(grouped, row)}
                  ariaLabel={control.accessibleLabel}
                  recommended={control.effects[0].code === recommendedCode}
                  icon={icon(control.id)}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  defaultValue={0}
                  value={control.value}
                  formatValue={control.mixed ? () => '개별 값' : formatValue}
                  formatAriaValue={control.mixed ? undefined : formatAriaValue}
                  onChange={(value) => onChange(noseControlChanges(control, value))}
                  onSelect={
                    onSelectControl &&
                    (() => onSelectControl(control.effects[0].code, control.accessibleLabel))
                  }
                  disabled={
                    disabled ||
                    control.unavailable ||
                    (!!onlyCode && control.effects[0].code !== onlyCode)
                  }
                />
                {control.mixed ? (
                  <p className="type-caption mt-(--space-6) text-muted-soft">
                    개별 조절값이 적용돼 있어요. 움직이면 함께 조절해요.
                  </p>
                ) : null}
                {control.unavailable && !control.loading ? (
                  <p className="type-caption mt-(--space-6) text-muted-soft">
                    이 모델에서 아직 조절할 수 없어요.
                  </p>
                ) : null}
              </div>
            ))}
          </ControlGroup>
        )
      })}
    </ControlStack>
  )
}
