import { Button, cx, Icon } from '@/shared/ui'
import type { CaptureDevice } from '../device'
import type { CaptureExchangeResult } from '../types'
import { CheckList } from './CheckList'

/**
 * SCR-17 업로드 전용 세션 ① 연결 확인 / Mobile (Figma 267:2657).
 * QR을 찍은 휴대폰이 어느 계정에 연결됐는지 보여 주고, 남의 계정이면 바로 끊게 한다(FN-CAP-04).
 * 영상 길이 안내는 이 화면에 두지 않는다(S15P31B204-770). 촬영 가이드에서도 뺐다(-882).
 *
 * 휴대폰 종류(아이폰·갤럭시)는 부모가 브라우저 정보로 판별해 넣고, 여기서는 묻지 않고 "○○으로 인식했어요"로만 보여 준다
 * (S15P31B204-442, 선택 단계가 불편하다는 피드백). 잘못 인식했을 때만 아래 작은 글자 링크("갤럭시(안드로이드)를 쓰고 있나요?")로
 * 반대 종류로 바꾼다(S15P31B204-882, 눈에 띄는 바꾸기 버튼과 고르기 묶음을 뺐다). 바꾸면 촬영 가이드의 "찍기 전에 확인해요"를 다시 본다(store `setDevice`).
 *
 * 아이폰 기종은 여기서 묻지 않고 "영상 촬영하기"를 누를 때 시트로 고른다(`IphoneModelSheet`, S15P31B204-635).
 */
export function ConnectConfirm({
  user,
  sessionMinutes,
  device,
  onDeviceChange,
  onContinue,
  onNotMine,
  isDisconnecting,
}: {
  user: CaptureExchangeResult['user']
  sessionMinutes: number
  device: CaptureDevice
  onDeviceChange: (device: CaptureDevice) => void
  onContinue: () => void
  onNotMine: () => void
  isDisconnecting: boolean
}) {
  return (
    <>
      <h1 className="text-[24px] leading-[1.3] font-[650] tracking-[-0.03em] break-keep text-text-ink">
        {user.nickname}님 계정으로 촬영해요
      </h1>
      {/* 2026-10-31: 상자 없이 줄과 머리카락 선으로만 나눈다(새 촬영 안내와 같은 모양) */}
      <p className="mt-(--space-10) flex w-full items-center gap-(--space-8)">
        <Icon name="User" size={15} className="shrink-0 text-text-muted" />
        <span className="text-[14px] break-all text-text-body">
          {user.maskedEmail ?? `${user.nickname}님`}
        </span>
      </p>
      <div className="mt-(--space-24) w-full border-t border-line-default pt-(--space-20)">
        <p className="text-[14.5px] leading-[1.55] break-keep text-text-paragraph">
          촬영한 영상은 PC의 내 작업실로 올라가요.
        </p>
        <CheckList
          className="mt-(--space-14)"
          items={[`연결은 ${sessionMinutes}분 동안 유지돼요`]}
        />
      </div>

      <DeviceNotice
        value={device}
        onChange={onDeviceChange}
        className="mt-(--space-20) border-t border-line-default pt-(--space-16)"
      />

      <div className="flex-1" />

      <Button variant="ink" className="mt-(--space-24) w-full" onClick={onContinue}>
        계속
      </Button>
      <button
        type="button"
        onClick={onNotMine}
        disabled={isDisconnecting}
        className="mx-auto mt-(--space-4) flex min-h-11 items-center px-(--space-8) type-kr-body-12-medium-lh15p6 text-text-body disabled:opacity-40"
      >
        {isDisconnecting ? '연결을 끊는 중…' : '내 계정이 아니에요'}
      </button>
    </>
  )
}

/** 조사까지 붙인 이름(아이폰으로 · 갤럭시(안드로이드)로) */
const DEVICE_RECOGNIZED: Record<CaptureDevice, string> = {
  iphone: '아이폰으로 인식했어요',
  android: '갤럭시(안드로이드)로 인식했어요',
}

const DEVICE_HINT: Record<CaptureDevice, string> = {
  iphone: '이 화면에서 카메라를 켜고, 화면과 음성 안내를 따라 찍어요.',
  android: '이 화면에서 카메라를 켜고, 화면과 음성 안내를 따라 찍어요. 기종은 자동으로 확인해요.',
}

/** 잘못 인식했을 때 누르는 작은 글자 링크. 누르면 반대 종류로 바꾼다 */
const DEVICE_SWITCH: Record<CaptureDevice, { label: string; to: CaptureDevice }> = {
  iphone: { label: '갤럭시(안드로이드)를 쓰고 있나요?', to: 'android' },
  android: { label: '아이폰을 쓰고 있나요?', to: 'iphone' },
}

/** 판별한 휴대폰 종류와 그에 맞는 촬영 방법. 아래 작은 링크로 반대 종류로 바꾼다 */
function DeviceNotice({
  value,
  onChange,
  className,
}: {
  value: CaptureDevice
  onChange: (device: CaptureDevice) => void
  className?: string
}) {
  const change = DEVICE_SWITCH[value]
  return (
    <div className={cx('w-full', className)}>
      <p className="text-[14px] font-semibold text-text-ink" aria-live="polite">
        {DEVICE_RECOGNIZED[value]}
      </p>
      <p className="mt-(--space-4) text-[12.5px] leading-[1.5] break-keep text-text-muted">
        {DEVICE_HINT[value]}
      </p>
      <button
        type="button"
        onClick={() => onChange(change.to)}
        className="-ml-(--space-4) flex min-h-11 items-center px-(--space-4) type-kr-caption-11-regular-lh14p3 text-text-body underline underline-offset-2"
      >
        {change.label}
      </button>
    </div>
  )
}
