import { useState } from 'react'
import { Button, Checkbox, Modal } from '@/shared/ui'

/**
 * 촬영 준비 시트(S15P31B204-635). 촬영 화면에 들어오면 먼저 연다.
 * 오른손으로 잡기(오른쪽부터 찍는다) → 소리 들어 보기 → "잘 들려요" 체크 → 촬영 시작(검사 모드).
 * 음성 안내를 끄면(-765) 소리 확인 없이 바로 시작한다.
 * "잘 들려요" 체크는 부모가 기억한다(`soundChecked`). 촬영 안내로 돌아갔다 와도 다시 체크하지 않게 한다(-882).
 * 소리 잠금은 "촬영 시작"이 다시 풀므로(부모의 start) 체크만 남겨도 된다.
 *
 * 아이폰은 사용자가 누르는 동작 안에서만 소리 재생·기울기 센서 권한을 허락한다.
 * 그래서 "소리 들어 보기"가 소리 잠금을 풀고, "촬영 시작"이 센서 권한을 묻는다(부모의 onSoundCheck·onStart).
 */
export function CaptureStartSheet({
  open,
  voiceOn,
  onVoiceChange,
  onSoundCheck,
  soundChecked = false,
  onSoundCheckedChange,
  onStart,
  onCancel,
}: {
  open: boolean
  /** 음성 안내 켜짐(-765). 끄면 소리 확인 없이 시작한다 */
  voiceOn: boolean
  onVoiceChange: (on: boolean) => void
  onSoundCheck: () => void
  /** 앞서 "잘 들려요"를 체크했다. 그러면 체크한 채로 연다 */
  soundChecked?: boolean
  onSoundCheckedChange?: (checked: boolean) => void
  onStart: () => void
  onCancel?: () => void
}) {
  const [played, setPlayed] = useState(soundChecked)
  const [heard, setHeard] = useState(soundChecked)
  return (
    <Modal
      open={open}
      onClose={() => onCancel?.()}
      title="촬영 준비"
      placement="sheet"
      dismissible={false}
    >
      <ol className="pf-live-prep">
        <li>
          <b>휴대폰은 오른손으로 잡아 주세요</b>
          <span>정면으로 시작해요.</span>
        </li>
        <li>
          <b>{voiceOn ? '소리를 켜 주세요' : '음성 안내 없이 찍어요'}</b>
          <span>
            {voiceOn
              ? '찍는 동안 음성으로 안내해요.'
              : '화면 글자로만 안내해요. 찍는 중에도 🔊 버튼으로 다시 켤 수 있어요.'}
          </span>
          {voiceOn ? (
            <>
              <Button
                variant="secondary"
                trailingIcon={null}
                className="mt-(--space-8) w-full"
                onClick={() => {
                  setPlayed(true)
                  onSoundCheck()
                }}
              >
                소리 들어 보기
              </Button>
              <Checkbox
                checked={heard}
                disabled={!played}
                onChange={(event) => {
                  setHeard(event.target.checked)
                  onSoundCheckedChange?.(event.target.checked)
                }}
              >
                잘 들려요
              </Checkbox>
            </>
          ) : null}
          <Checkbox checked={!voiceOn} onChange={(event) => onVoiceChange(!event.target.checked)}>
            음성 안내 끄기 (촬영에 익숙하다면)
          </Checkbox>
        </li>
      </ol>
      <Button
        variant="ink"
        className="mt-(--space-20) w-full"
        disabled={voiceOn && !heard}
        onClick={onStart}
      >
        촬영 시작
      </Button>
      {onCancel ? (
        <button type="button" className="pf-live-back mt-(--space-12) w-full" onClick={onCancel}>
          촬영 안내로 돌아가기
        </button>
      ) : null}
    </Modal>
  )
}
