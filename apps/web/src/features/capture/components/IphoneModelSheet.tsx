import { useState } from 'react'
import { Button, Modal, cx } from '@/shared/ui'
import { IPHONE_GENERATIONS, iphoneGenerationOf } from '../device'

const UNKNOWN = ''

/** 작은 글씨용 짧은 이름: "iPhone 16 Pro Max" → "16 Pro Max", "iPhone Air" → "Air" */
const shortName = (model: string) => model.replace(/^iPhone /, '')

/**
 * 아이폰 기종 고르기 시트(S15P31B204-635). "영상 촬영하기"를 누르면 아이폰일 때 연다.
 * Safari는 기종을 알려 주지 않아 사용자가 고르고, 고른 값은 업로드 요청의 `deviceModel`로 가서 렌즈 출발값이 된다.
 * 모르면 "모름"(보내지 않음). 작은 드롭다운이 누르기 어렵다는 의견으로 큰 행 목록(라디오)으로 바꿨다.
 * 기종 28개가 29줄(약 1,500px)이라 스크롤이 길어서 세대별 9줄로 묶었다(-756). 같은 세대는 렌즈 초점이 같다(`IPHONE_GENERATIONS`).
 * 줄 아래 작은 글씨로 그 세대 기종을 보여 준다(이름에 숫자가 없는 Air도 찾게).
 */
export function IphoneModelSheet({
  open,
  value,
  onConfirm,
  onClose,
}: {
  open: boolean
  value: string | null
  onConfirm: (model: string | null) => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="아이폰 기종을 골라 주세요" placement="sheet">
      {/* 열 때마다 지금 값에서 다시 시작하도록 열린 동안만 그린다 */}
      {open ? <ModelPicker value={value} onConfirm={onConfirm} /> : null}
    </Modal>
  )
}

function ModelPicker({
  value,
  onConfirm,
}: {
  value: string | null
  onConfirm: (model: string | null) => void
}) {
  // 예전 시트에서 고른 기종 이름("iPhone 16 Pro" 등)도 그 세대 줄로 연다
  const [picked, setPicked] = useState(iphoneGenerationOf(value)?.value ?? UNKNOWN)
  const options = [
    ...IPHONE_GENERATIONS.map((g) => ({
      value: g.value,
      label: g.label,
      detail: g.models.length > 1 ? g.models.map(shortName).join(' · ') : null,
    })),
    // 대부분 자기 기종을 알아서 "모름"은 맨 아래에 둔다(-756)
    { value: UNKNOWN, label: '모름', detail: null },
  ]
  return (
    <>
      <p className="type-kr-body-13-medium-lh16p9 break-keep text-text-muted">
        기종을 고르면 3D를 만들 때 카메라 렌즈 값을 더 정확히 맞춰요.
      </p>
      <div
        role="radiogroup"
        aria-label="아이폰 기종"
        className="mt-(--space-12) flex flex-col divide-y divide-line-default"
      >
        {options.map((option) => {
          const checked = picked === option.value
          const detailId = option.detail
            ? `iphone-gen-${option.value.replace(/\W+/g, '-')}`
            : undefined
          return (
            <label
              key={option.value || 'unknown'}
              className={cx(
                'flex min-h-13 cursor-pointer items-center justify-between gap-(--space-12) px-(--space-4) py-(--space-8)',
                'text-[16px] text-text-ink',
                checked && 'font-semibold',
              )}
            >
              <span className="flex min-w-0 flex-col gap-(--space-2)">
                {option.label}
                {option.detail ? (
                  <span
                    id={detailId}
                    className="type-kr-body-12-regular-lh15p6 font-normal break-keep text-text-muted"
                  >
                    {option.detail}
                  </span>
                ) : null}
              </span>
              {/* 이름은 줄 제목만, 세대 기종 목록은 설명으로 읽힌다 */}
              <input
                type="radio"
                name="iphone-model"
                aria-label={option.label}
                aria-describedby={detailId}
                value={option.value}
                checked={checked}
                onChange={() => setPicked(option.value)}
                className="size-5 accent-brand-violet"
              />
            </label>
          )
        })}
      </div>
      <Button
        variant="ink"
        trailingIcon={null}
        className="mt-(--space-20) w-full"
        onClick={() => onConfirm(picked === UNKNOWN ? null : picked)}
      >
        이 기종으로 촬영하기
      </Button>
    </>
  )
}
