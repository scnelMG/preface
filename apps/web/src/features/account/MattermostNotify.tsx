'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { Button, Checkbox, toast } from '@/shared/ui'
import { accountApi, type MattermostCodeSent } from './api'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * 별도 동의 고지(S15P31B204-543, 개인정보 보호법 제15조제2항 4항목). 처리방침에 들어가기 전에도 이 동의를 근거로 받는다.
 * 항목·목적(SSAFY Mattermost 경유)·보유 기간·거부권을 모두 적는다.
 */
export const MM_NOTICE =
  '(선택) Mattermost 아이디와 연결 시각을 받아, 3D 생성 결과를 SSAFY Mattermost DM으로 알려 드려요. 알림을 끄거나 탈퇴하면 바로 지워요. 동의하지 않아도 서비스는 그대로 쓸 수 있어요.'
export const MM_FALLBACK_ERROR = '잠시 후 다시 시도해 주세요.'
/** 이메일 주소 전체(아이디@도메인)를 넣는 경우가 있어 입력칸 아래에 둔다 */
export const MM_ID_HINT =
  '이메일 주소 전체가 아니라 아이디만 적어 주세요. 예: hong@ssafy.com이면 hong'

/** 입력칸: 사이트 토큰(흰 면·머리카락 선·반경 12, 2026-10-31) */
const INPUT_CLASS =
  'h-[46px] w-full rounded-[12px] border border-[var(--pf-hairline-strong)] bg-[var(--pf-surface)] px-(--space-14) text-[14.5px] text-text-ink placeholder:text-text-muted transition-[border-color] duration-150 focus-visible:border-text-ink focus-visible:outline-none'

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : MM_FALLBACK_ERROR
}

/**
 * SCR-12 알림 — Mattermost 완료 알림 등록(S15P31B204-476).
 *
 * 1차 사용자 대부분이 SSAFY 교육생·컨설턴트·코치라 SSAFY Mattermost DM으로 3D 생성 결과를 알린다.
 * 아이디만 받는다(이름·학번 없음). 입력한 아이디로 6자리 코드를 DM으로 보내고, 코드가 맞아야 등록한다 —
 * 오타나 남의 아이디로 알림이 가지 않게 하려는 것이다.
 *
 * 3D 생성 대기 화면도 같은 칸을 펼쳐 바로 등록한다(S15P31B204-524). 그때는 화면이 이미 안내 문구를 보여 주므로
 * 제목을 뺀다(`heading={false}`). 보여 줄지는 부르는 쪽이 `useMattermostNotifyAvailable()`로 정한다.
 */
export function MattermostNotify({
  username,
  onChange,
  heading = true,
}: {
  /** 등록된 아이디. 없으면 null */
  username: string | null
  /** 등록·해제 뒤 바뀐 아이디 */
  onChange: (username: string | null) => void
  /** 제목·설명 줄을 보일지. 기본은 보인다 */
  heading?: boolean
}) {
  const [input, setInput] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [sent, setSent] = useState<MattermostCodeSent | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // 다시 받기 버튼을 간격이 지나면 켠다
  useEffect(() => {
    if (!sent) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [sent])

  async function requestCode(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await accountApi.mattermostRequestCode(input.trim())
      setSent(result)
      setCode('')
      setNow(Date.now())
      toast(`@${result.username}에게 확인 코드를 보냈어요. Mattermost DM을 확인해 주세요.`)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const link = await accountApi.mattermostConfirm(code.trim())
      setSent(null)
      setInput('')
      setAgreed(false)
      onChange(link.username)
      toast('Mattermost 알림을 켰어요.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    setError(null)
    try {
      await accountApi.mattermostUnlink()
      onChange(null)
      toast('Mattermost 알림을 껐어요.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const resendWait = sent
    ? Math.max(0, Math.ceil((Date.parse(sent.resendAvailableAt) - now) / 1000))
    : 0

  return (
    <div className="flex flex-col gap-(--space-12) py-(--space-16)">
      {heading ? (
        <div className="flex flex-col gap-(--space-2)">
          <span className="text-[14.5px] font-medium text-text-ink">Mattermost 완료 알림</span>
          <span className="text-[12.5px] leading-[1.5] break-keep text-text-muted">
            {username ? (
              <>
                <span {...PRIVATE_TEXT}>@{username}</span>(으)로 3D 생성 결과를 알려 드려요.
              </>
            ) : (
              'SSAFY 교육생·컨설턴트·코치님은 Mattermost로 생성 완료 알림을 받을 수 있어요.'
            )}
          </span>
        </div>
      ) : null}

      {username ? (
        <Button
          leadingIcon={null}
          trailingIcon={null}
          variant="secondary"
          className="self-start"
          onClick={() => void unlink()}
          disabled={busy}
          aria-busy={busy}
        >
          알림 끄기
        </Button>
      ) : sent ? (
        <form className="flex flex-col gap-(--space-10)" onSubmit={(e) => void confirm(e)}>
          <label className="flex flex-col gap-(--space-4)">
            <span className="text-[12.5px] font-medium text-text-paragraph">
              <span {...PRIVATE_TEXT}>@{sent.username}</span>에게 보낸 6자리 코드
            </span>
            <input
              {...PRIVATE_TEXT}
              className={INPUT_CLASS}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </label>
          <div className="flex flex-wrap gap-(--space-8)">
            <Button
              leadingIcon={null}
              trailingIcon={null}
              variant="ink"
              type="submit"
              disabled={busy || code.length !== 6}
              aria-busy={busy}
            >
              등록
            </Button>
            <Button
              leadingIcon={null}
              trailingIcon={null}
              variant="secondary"
              onClick={() => void requestCode()}
              disabled={busy || resendWait > 0}
            >
              {resendWait > 0 ? `코드 다시 받기 (${resendWait}초)` : '코드 다시 받기'}
            </Button>
            <Button
              leadingIcon={null}
              trailingIcon={null}
              variant="text"
              onClick={() => {
                setSent(null)
                setError(null)
              }}
              disabled={busy}
            >
              아이디 바꾸기
            </Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-(--space-10)" onSubmit={(e) => void requestCode(e)}>
          {/* 보이는 이름표 대신 입력칸 안내 글(읽는 이름은 aria-label) */}
          <input
            {...PRIVATE_TEXT}
            aria-label="Mattermost 아이디"
            className={INPUT_CLASS}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="@Mattermost 아이디"
            aria-describedby="mm-id-hint"
          />
          <p
            id="mm-id-hint"
            className="-mt-(--space-4) text-[12.5px] leading-[1.5] break-keep text-text-muted"
          >
            {MM_ID_HINT}
          </p>
          <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)}>
            {/* 어절 단위로 줄을 바꾼다 */}
            <span className="text-[12.5px] leading-[1.5] break-keep text-pretty text-text-muted">
              {MM_NOTICE}
            </span>
          </Checkbox>
          <Button
            leadingIcon={null}
            trailingIcon={null}
            variant="ink"
            type="submit"
            className="self-start"
            disabled={busy || !agreed || input.trim().length === 0}
            aria-busy={busy}
          >
            확인 코드 받기
          </Button>
        </form>
      )}

      {error ? (
        <p role="alert" className="text-[13px] text-status-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
