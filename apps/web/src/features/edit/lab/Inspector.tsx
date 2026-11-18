'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ControlRail } from '../controls/ControlRail'
import { ContourIcon } from '../controls/ContourIcon'
import { NoseControlGroups } from '../controls/NoseControlGroups'
import { CONTOUR_GROUPS, contourControls } from '../contourControls'
import { EDITABLE_PARTS } from '../editLogic'
import { noseControls, type MorphValueChange } from '../noseControls'
import type { MorphParameterCatalog } from '../types'
import {
  weightShapeControls,
  weightShapeSliderValue,
  weightShapeStrengthLabel,
} from '../weightShapeControls'
import { toastOnce } from './toastOnce'

/**
 * 편집실 오른쪽 조작 카드(2026-11-01 재구성, 메인 체험과 같은 부품).
 * 유리 카드 · `직접 조절 | 상담` 레일(둘 이상일 때만) · 부위 레일 · 묶음(제목 + 아이콘 달린 슬라이더 줄).
 */

export type InspectorMode = 'manual' | 'consult' | 'photo'

export function EditModeSwitch({
  resetLabel,
  toWeight,
  disabled,
  onSwitch,
}: {
  resetLabel: string
  toWeight: boolean
  disabled?: boolean
  onSwitch: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-(--space-8)">
      <p className="type-caption text-muted-soft" role="status">
        버튼을 누르면 {resetLabel} 조절값이 원래대로 돌아가요.
      </p>
      <button
        type="button"
        onClick={onSwitch}
        disabled={disabled}
        className="type-label min-h-9 rounded-full bg-ink/5 px-(--space-12) text-ink hover:bg-ink/10 disabled:text-faint"
      >
        {toWeight ? '체중 변화 미리보기' : '눈·코·윤곽 조절하기'}
      </button>
    </div>
  )
}

const MODES: Record<InspectorMode, { label: string }> = {
  manual: { label: '직접 조절' },
  consult: { label: '상담' },
  // 촬영한 내 정면 사진(S15P31B204-770). 사진이 있는 3D에서만 탭을 넘긴다
  photo: { label: '원본 사진' },
}

export function Inspector({
  modes,
  mode,
  onModeChange,
  aside,
  children,
}: {
  modes: InspectorMode[]
  mode: InspectorMode
  onModeChange: (mode: InspectorMode) => void
  /** 편집 방식 줄 오른쪽(예: 처음으로). 두 방식 모두에 걸리는 행동만 둔다 */
  aside?: ReactNode
  children: ReactNode
}) {
  // PC 카드의 상담 높이는 부위와 관계없이 코 탭 직접 조절 카드 높이로 고정한다(service.css `--pf-lab-consult-h`, -748).
  // 전에는 직접 조절에서 잰 높이를 따라가 윤곽·헤어를 보다 바꾸면 상담 카드가 길어졌다
  return (
    <>
      {modes.length > 1 ? (
        // 휴대폰은 화면이 작아 손잡이 바로 아래에 붙인다(위 여백 20 → 4)
        <div className="flex items-center justify-between gap-(--space-12) px-(--space-20) pt-(--space-4) md:pt-(--space-20)">
          {/* 편집실 첫 사용 안내가 가리키는 곳(data-tutorial) */}
          <div data-tutorial="modes" className="rounded-(--pf-radius-sm)">
            <ControlRail
              label="편집 방식"
              size="sm"
              value={mode}
              onChange={onModeChange}
              items={modes.map((value) => ({ value, label: MODES[value].label }))}
            />
          </div>
          {aside}
        </div>
      ) : null}

      <div
        id="inspector-panel"
        role="tabpanel"
        aria-label={MODES[mode].label}
        // 휴대폰 시트에서 상담은 입력창을 바닥에 붙인다(service.css)
        data-mode={mode}
        // 휴대폰 시트에서 조절을 넘기는 영역. 접힘 높이를 잴 때 넘긴 만큼을 되돌린다(useControlSheet)
        data-sheet-scroll
        className="flex flex-col px-(--space-20) pb-(--space-24) md:min-h-0 md:flex-1 md:overflow-y-auto"
      >
        {children}
      </div>
    </>
  )
}

/**
 * 부위 탭에 보이는 순서(2026-11-04: 눈을 코 앞으로). 열 수 있는 부위는 EDITABLE_PARTS와 눈·헤어 패널이 정한다.
 * 헤어 패널을 넘기지 않는 화면은 헤어가 `연결 예정`이다.
 */
const PART_TABS = [
  { part: 'EYE', label: '눈' },
  { part: 'NOSE', label: '코' },
  { part: 'CONTOUR', label: '윤곽' },
  { part: 'WEIGHT_SHAPE', label: '체중' },
  { part: 'HAIR', label: '헤어' },
] as const

/**
 * Figma `직접 조절`(P3-68) — 부위 탭 + 슬라이더.
 *
 * 슬라이더를 놓을 때 저장하려고 native `change` 이벤트를 받는다. React의 onChange는 움직이는 동안 계속 오고
 * (미리보기), 브라우저의 `change`는 손을 뗄 때(키보드는 한 칸마다) 한 번 온다(FN-EDIT-03 수용 3).
 */
export function ManualPanel({
  catalog,
  weights,
  part,
  onPartChange,
  onSelectControl,
  onPreview,
  onPreviewBatch,
  onCommit,
  disabled,
  focusCode,
  recommendedCode,
  error,
  supportedCodes,
  modelLoading = false,
  eyeLoading = false,
  eyePanel,
  hairPanel,
  weightShapeAvailable = false,
  modeSwitch,
}: {
  catalog: MorphParameterCatalog | null
  weights: Readonly<Record<string, number>>
  part: string
  onPartChange: (part: string) => void
  onSelectControl?: (code: string, label: string) => void
  /** 움직이는 동안 값을 바꾼다. */
  onPreview: (code: string, value: number) => void
  onPreviewBatch?: (changes: readonly MorphValueChange[]) => void
  /** 손을 뗐다 */
  onCommit: () => void
  /** 항목별 ⟲ */
  disabled?: boolean
  /** 상담이 연 슬라이더(CON-01 `recommendedSliderCode`) */
  focusCode?: string | null
  recommendedCode?: string | null
  error?: ReactNode
  /** null이면 아직 모델을 읽는 중. 카탈로그와 렌더 지원의 교집합만 조절한다. */
  supportedCodes?: readonly string[] | null
  modelLoading?: boolean
  /** 눈을 열 수 있는지 아직 모른다(3D의 눈 판정을 읽는 중). 눈 탭을 막지 않고 불러오는 중으로 보인다 */
  eyeLoading?: boolean
  /** 있으면 눈 탭을 열고 눈 탭에서 이 내용을 보인다(눈 편집이 준비된 모델만) */
  eyePanel?: ReactNode
  /** 있으면 헤어 탭을 열고 이 내용을 보인다(S15P31B204-699). 탭 이름 옆 `베타`는 뗐다(S15P31B204-838) */
  hairPanel?: ReactNode
  weightShapeAvailable?: boolean
  modeSwitch?: { resetLabel: string; onSwitch: () => void }
}) {
  const slidersRef = useRef<HTMLDivElement>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  })

  useEffect(() => {
    const node = slidersRef.current
    if (!node) return
    const listener = (event: Event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === 'range' &&
        !event.target.closest('fieldset')
      ) {
        commitRef.current()
      }
    }
    node.addEventListener('change', listener)
    return () => node.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    if (!focusCode) return
    const controls = slidersRef.current?.querySelectorAll<HTMLInputElement>(
      '[data-code] input[type="range"]',
    )
    const input = Array.from(controls ?? []).find(
      (control) => control.closest<HTMLElement>('[data-code]')?.dataset.code === focusCode,
    )
    input?.focus()
  }, [focusCode, part])

  // 실제 조절은 카탈로그와 해당 모델이 확인한 부위에만 제공한다.
  const available = new Set(
    catalog?.parts.map((p) => p.part as string).filter((p) => EDITABLE_PARTS.has(p)) ?? [],
  )
  if (eyePanel) available.add('EYE')
  if (hairPanel) available.add('HAIR')
  if (weightShapeAvailable) available.add('WEIGHT_SHAPE')
  const loading = modelLoading || (!catalog && !error) || supportedCodes === null
  const pending = (tab: string) => loading || (tab === 'EYE' && eyeLoading)
  const blocked = (tab: string) => !available.has(tab) && (!pending(tab) || tab === 'HAIR')
  const unavailableMessage = (tab: string, label: string) =>
    tab === 'WEIGHT_SHAPE'
      ? '이 모델은 체중 변화 미리보기를 지원하지 않아요.'
      : tab === 'EYE'
        ? '이 모델에서 눈 조절에 필요한 형상 정보가 확인되지 않았어요.'
        : `${label} 조절은 아직 사용할 수 없어요.`
  const selected = PART_TABS.find((tab) => tab.part === part)
  const group = available.has(part) ? catalog?.parts.find((p) => p.part === part) : undefined
  const controls =
    part === 'NOSE' && group && catalog
      ? noseControls(catalog, weights, supportedCodes)
      : part === 'CONTOUR' && group && catalog
        ? contourControls(catalog, weights, supportedCodes)
        : part === 'WEIGHT_SHAPE' && catalog
          ? weightShapeControls(catalog, weights, supportedCodes)
          : []
  const previewChanges = (changes: readonly MorphValueChange[]) => {
    if (onPreviewBatch) onPreviewBatch(changes)
    else changes.forEach(({ code, value }) => onPreview(code, value))
  }

  return (
    <>
      {/* 부위 레일(막힌 부위를 누르면 조절할 수 없는 이유를 알린다).
          휴대폰 시트에서는 조절을 넘겨도 위에 붙어 있다(service.css `data-part-rail`, -573) */}
      <div data-part-rail className="mt-(--space-16)">
        <ControlRail
          label="부위"
          variant="quiet"
          value={part}
          onChange={onPartChange}
          onBlocked={(tab) => {
            if (!blocked(tab.value)) return
            toastOnce(unavailableMessage(tab.value, String(tab.label)))
          }}
          items={PART_TABS.map((tab) => ({
            value: tab.part,
            label: tab.label,
            disabled:
              !available.has(tab.part) &&
              !(modelLoading && tab.part !== 'HAIR') &&
              !(eyeLoading && tab.part === 'EYE'),
            note: blocked(tab.part)
              ? tab.part === 'EYE' || tab.part === 'WEIGHT_SHAPE'
                ? '미지원'
                : '예정'
              : undefined,
          }))}
        />
      </div>

      <div
        ref={slidersRef}
        onBlurCapture={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === 'range' &&
            !event.target.closest('fieldset')
          ) {
            commitRef.current()
          }
        }}
        className="pp-adjustments flex flex-col gap-(--space-32) pt-(--space-20)"
      >
        {!modelLoading && modeSwitch ? (
          <EditModeSwitch {...modeSwitch} toWeight={part === 'WEIGHT_SHAPE'} disabled={disabled} />
        ) : null}
        {!modelLoading && !modeSwitch && part === 'EYE' ? eyePanel : null}
        {!modelLoading && part === 'HAIR' ? hairPanel : null}
        {!modelLoading && error}
        {!loading && selected && blocked(part) ? (
          <p className="type-caption text-muted-soft" role="status">
            {unavailableMessage(part, selected.label)}
          </p>
        ) : null}
        {modelLoading || (!catalog && !error) || (part === 'EYE' && eyeLoading && !eyePanel) ? (
          <p className="type-caption text-muted-soft" role="status">
            조절 항목을 불러오는 중이에요
          </p>
        ) : null}
        {!modelLoading && !modeSwitch && controls.length ? (
          // 부위를 바꾸면 key가 바뀌어 묶음이 한 번 차례로 나타난다
          <NoseControlGroups
            key={part}
            controls={controls}
            recommendedCode={recommendedCode}
            onChange={previewChanges}
            onSelectControl={onSelectControl}
            disabled={disabled}
            {...(part === 'WEIGHT_SHAPE'
              ? {
                  groups: ['체중'],
                  icon: () => <ContourIcon id="cheekVolume" />,
                  formatValue: weightShapeSliderValue,
                  formatAriaValue: weightShapeStrengthLabel,
                }
              : part === 'CONTOUR'
                ? {
                    groups: CONTOUR_GROUPS,
                    icon: (id: string) => <ContourIcon id={id} />,
                  }
                : {})}
          />
        ) : null}
      </div>
    </>
  )
}
/**
 * 체험 화면의 AI 상담 안내(2026-10-30 톤 정리). 상자·버튼 없이 조절 카드 아래 한 줄: 보라 점 + 짧은 말 + 글자 링크.
 * Figma `로그인 유도`(P3-61 체험) — AI 상담은 로그인 뒤.
 */
export function LoginNudge({ onLogin }: { onLogin: () => void }) {
  return (
    <p className="type-caption mt-(--space-24) flex items-center gap-(--space-6) text-muted-soft">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
      AI 상담은 로그인하면 이용할 수 있어요
      <button
        type="button"
        onClick={onLogin}
        aria-label="로그인하고 AI 상담 시작"
        className="ml-auto shrink-0 font-medium text-ink underline-offset-2 hover:underline"
      >
        로그인
      </button>
    </p>
  )
}
