'use client'

import Link from 'next/link'
import { type ClipboardEvent, useCallback, useEffect, useId, useState } from 'react'
import { isMobileDevice } from '@/features/capture/device'
import { latestLegalPath } from '@/features/legal/documents'
import { PRIVATE_TEXT } from '@/shared/analytics'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { Button } from '@/shared/ui/Button'
import { Modal } from '@/shared/ui/Modal'
import { toast } from '@/shared/ui/Toast'
import { createShare, isOpenShare, listShares, revokeShare } from './api'
import { checkSenderName, nameMaxLength, SENDER_NAME_MAX, senderNameLength } from './senderName'
import type { ShareSummary } from './types'

export const SHARE_NOTICE =
  '링크를 받은 사람은 로그인 없이 원래 얼굴과 결과 3D를 볼 수 있어요. 7일 뒤 자동으로 닫혀요. 그 전에 끝내려면 이 창의 공유 중인 링크에서 공유 끝내기를 누르세요(편집실의 시안 공유 버튼으로 다시 열 수 있어요). 받은 사람이 화면을 저장하는 것은 막을 수 없어요.'
const EMPTY_SIMULATION = '변경한 뒤 공유할 수 있어요'
const SAVING = '조절을 저장하는 중이에요. 저장이 끝나면 링크를 만들 수 있어요'
const CONSENT_REQUIRED = '공유하려면 얼굴 데이터 공개 동의가 필요해요'
const DAY_MS = 24 * 60 * 60 * 1000
/** 링크 복사 뒤 버튼 아래에 남는 안내. PC는 공유 창 없이 복사만 하므로 다음에 할 일을 알린다 */
export const COPIED_MESSAGE = '링크를 복사했어요. 카톡이나 메시지에 붙여 넣어 보내세요.'
export const SENDER_NAME_LABEL = '받는 사람에게 보일 이름 (선택)'
export const SENDER_NAME_HINT = '링크를 받은 사람 모두에게 보여요. 비워 두면 이름 없이 보내요'
const SENDER_NAME_ERROR = {
  'too-long': `이름은 ${SENDER_NAME_MAX}자까지 쓸 수 있어요`,
  'invalid-char': '이름에 쓸 수 없는 문자가 있어요',
} as const
/** 20자를 다 채웠을 때 아래에 보이는 안내(입력은 더 늘지 않는다) */
export const SENDER_NAME_LIMIT = `최대 ${SENDER_NAME_MAX}자까지 쓸 수 있어요`
type NameProblem = keyof typeof SENDER_NAME_ERROR

type Problem = 'empty' | 'consent' | 'failed' | null

/**
 * 시안 공유 시트(설계 docs/design/simulation-share.md 4절 ①). 링크 만들기 → 공유하기(OS 공유 창)·링크 복사, 공유 중인 링크 목록과 끝내기.
 *
 * 공유하기는 휴대폰·태블릿에서만 보인다(S15P31B204-892). PC(Windows 등)의 OS 공유 창은 카카오톡 PC 앱 등으로 이어져 헷갈리므로
 * PC는 링크 복사만 두고, 복사하면 붙여 넣어 보내라고 버튼 아래에 알린다. 모바일 여부는 화면 폭이 아니라 기기 정보(`isMobileDevice`)로 가른다.
 * 휴대폰이라도 `navigator.share`가 없으면 복사만 보인다.
 *
 * 링크(토큰)는 이 시트가 열려 있는 동안 상태에만 둔다. 서버는 다시 주지 않는다(해시만 저장).
 * 공유 창(`navigator.share`)은 사용자 탭 안에서만 열리므로, 링크를 먼저 만들고 `공유하기`를 따로 누르게 한다(iOS Safari).
 * 공유 동의 체크는 재동의 API(-517)가 생기면 붙인다. 지금은 안내와 동의서 링크만 보인다.
 *
 * 서버는 링크를 만드는 순간의 저장된 시안을 스냅숏으로 뜬다. 편집 저장이 도는 동안(`saving`) 만들면 화면의 얼굴이 아닌
 * 저장 전 얼굴이 공유돼, 받은 사람의 원래 얼굴·결과가 같아 보였다. 그래서 저장이 끝날 때까지 만들지 않는다(S15P31B204-842).
 * 편집실 헤어(`hairId`)는 서버 시안에 저장하지 않으므로 만들 때 같이 보낸다.
 * 보내는 사람 이름은 사용자가 직접 적은 값만 보낸다. 계정 닉네임을 미리 채우지 않는다(S15P31B204-843, 개인정보).
 * 이름 규칙은 화면에서 먼저 알리고 막는다: 20자에서 더 쳐지지 않고(코드 포인트 기준) 안내를 보이며, 더 긴 글을 붙이면
 * 붙인 그대로 두고 20자 안내와 함께 링크 만들기를 막는다. 서버 검사(COMMON_001)는 안전망이고, 그래도 걸리면 같은 자리에 같은 문구를 보인다.
 */
export function ShareSheet({
  open,
  onClose,
  simulationId,
  hasChanges,
  saving = false,
  hairId = null,
}: {
  open: boolean
  onClose: () => void
  simulationId: string
  hasChanges: boolean
  /** 편집 저장이 아직 끝나지 않았다(미리보기·저장 중) */
  saving?: boolean
  /** 씌워 둔 웹 헤어 ID. 없으면 null */
  hairId?: string | null
}) {
  const [shares, setShares] = useState<ShareSummary[]>([])
  const [link, setLink] = useState<{ shareId: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const [senderName, setSenderName] = useState('')
  const [serverNameProblem, setServerNameProblem] = useState<NameProblem | null>(null)
  const nameCheck = checkSenderName(senderName)
  const nameProblem: NameProblem | null = nameCheck.ok ? serverNameProblem : nameCheck.reason
  const atNameLimit = senderNameLength(senderName) >= SENDER_NAME_MAX
  const nameId = useId()
  const nameHintId = `${nameId}-hint`

  const refresh = useCallback(async () => {
    try {
      setShares(await listShares(simulationId))
    } catch {
      // 목록을 못 불러와도 만들기는 할 수 있다
    }
  }, [simulationId])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listShares(simulationId, controller.signal).then(setShares, () => {
      // 목록을 못 불러와도 만들기는 할 수 있다
    })
    return () => controller.abort()
  }, [open, simulationId])

  function changeSenderName(value: string) {
    setSenderName(value)
    setServerNameProblem(null)
  }

  /** 20자를 넘게 붙이면 브라우저가 몰래 자르지 않게 붙인 그대로 넣고, 20자 안내로 막는다 */
  function pasteSenderName(e: ClipboardEvent<HTMLInputElement>) {
    const input = e.currentTarget
    const start = input.selectionStart ?? senderName.length
    const end = input.selectionEnd ?? start
    const next =
      senderName.slice(0, start) + e.clipboardData.getData('text') + senderName.slice(end)
    if (senderNameLength(next) <= SENDER_NAME_MAX) return
    e.preventDefault()
    changeSenderName(next)
  }

  async function create() {
    if (saving || !nameCheck.ok) return
    setBusy(true)
    setProblem(null)
    setServerNameProblem(null)
    try {
      const created = await createShare(simulationId, {
        hairAssetId: hairId,
        senderName: nameCheck.name,
      })
      setLink({ shareId: created.shareId, url: created.shareUrl })
      setCopied(false)
      await refresh()
    } catch (e) {
      if (e instanceof ApiError && e.code === ErrorCode.SHARE_EMPTY_SIMULATION) setProblem('empty')
      else if (e instanceof ApiError && e.code === ErrorCode.SHARE_CONSENT_REQUIRED)
        setProblem('consent')
      // 화면 검사를 지나도 서버가 이름을 거절하면(규칙 차이 등) 일반 오류가 아니라 입력 옆에 같은 문구로 알린다
      else if (e instanceof ApiError && e.code === ErrorCode.INVALID_REQUEST && nameCheck.name)
        setServerNameProblem(
          senderNameLength(nameCheck.name) > SENDER_NAME_MAX ? 'too-long' : 'invalid-char',
        )
      else setProblem('failed')
    } finally {
      setBusy(false)
    }
  }

  async function shareLink() {
    if (!link) return
    try {
      await navigator.share({ title: 'Preface 시안', url: link.url })
    } catch (e) {
      // 사용자가 공유 창을 닫은 것은 오류가 아니다
      if (e instanceof DOMException && e.name === 'AbortError') return
      toast('공유 창을 열지 못했어요. 링크를 복사해 주세요')
    }
  }

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
      toast('복사하지 못했어요. 다시 시도해 주세요')
    }
  }

  async function revoke(shareId: string) {
    try {
      await revokeShare(shareId)
      // 방금 만든 링크를 끝냈으면 죽은 링크를 복사하지 못하게 거두고, 새 링크를 만들 수 있게 한다
      if (link?.shareId === shareId) {
        setLink(null)
        setCopied(false)
      }
    } catch {
      toast('공유를 끝내지 못했어요. 다시 시도해 주세요')
    } finally {
      await refresh()
    }
  }

  const now = new Date()
  const openShares = shares.filter((s) => isOpenShare(s, now))
  // 공유 창은 휴대폰·태블릿에서만 연다. PC의 OS 공유 창은 카카오톡 PC 앱 등으로 이어져 헷갈린다(S15P31B204-892)
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function' && isMobileDevice()

  return (
    <Modal open={open} onClose={onClose} title="시안 공유" placement="sheet">
      <div className="flex flex-col">
        <p className="mt-(--space-20) text-[15px] leading-[1.6] break-keep text-ink-2">
          {SHARE_NOTICE}
        </p>

        {!hasChanges || problem === 'empty' ? (
          <p className="type-caption mt-(--space-12) text-ink-2">{EMPTY_SIMULATION}</p>
        ) : null}
        {hasChanges && saving && !link ? (
          <p role="status" className="type-caption mt-(--space-12) text-ink-2">
            {SAVING}
          </p>
        ) : null}
        {problem === 'consent' ? (
          <p role="alert" className="type-caption mt-(--space-12) text-status-danger">
            {CONSENT_REQUIRED}{' '}
            <Link href={latestLegalPath('face-public')} target="_blank" className="underline">
              동의서 보기
            </Link>
          </p>
        ) : null}
        {problem === 'failed' ? (
          <p role="alert" className="type-caption mt-(--space-12) text-status-danger">
            링크를 만들지 못했어요. 다시 시도해 주세요
          </p>
        ) : null}

        {link ? (
          <>
            <div className="mt-(--space-24) flex gap-(--space-8)">
              {canNativeShare ? (
                <Button
                  type="button"
                  variant="ink"
                  leadingIcon="PaperPlaneTilt"
                  trailingIcon={null}
                  onClick={shareLink}
                  className="flex-1"
                >
                  공유하기
                </Button>
              ) : null}
              {/* PC는 복사가 유일한 동작이라 주 버튼(잉크)으로 둔다 */}
              <Button
                type="button"
                variant={canNativeShare ? 'secondary' : 'ink'}
                trailingIcon={null}
                onClick={copyLink}
                className="flex-1"
              >
                링크 복사
              </Button>
            </div>
            {copied ? (
              <p role="status" className="type-caption mt-(--space-12) break-keep text-ink-2">
                {COPIED_MESSAGE}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="mt-(--space-24) flex flex-col gap-(--space-6)">
              <label htmlFor={nameId} className="type-label text-ink">
                {SENDER_NAME_LABEL}
              </label>
              <input
                {...PRIVATE_TEXT}
                id={nameId}
                type="text"
                value={senderName}
                onChange={(e) => changeSenderName(e.target.value)}
                onPaste={pasteSenderName}
                maxLength={nameMaxLength(senderName)}
                placeholder="예: 지은"
                autoComplete="off"
                aria-invalid={nameProblem !== null}
                aria-describedby={nameHintId}
                className="type-caption w-full rounded-7 border border-line-default bg-transparent px-(--space-14) py-(--space-10) text-ink placeholder:text-text-muted"
              />
              <span id={nameHintId} className="type-caption break-keep text-ink-2">
                {SENDER_NAME_HINT}
              </span>
              {nameProblem ? (
                <span role="alert" className="type-caption text-status-danger">
                  {SENDER_NAME_ERROR[nameProblem]}
                </span>
              ) : atNameLimit ? (
                <span role="status" className="type-caption text-ink-2">
                  {SENDER_NAME_LIMIT}
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ink"
              leadingIcon="PaperPlaneTilt"
              trailingIcon={null}
              onClick={create}
              disabled={!hasChanges || busy || saving || !nameCheck.ok}
              className="mt-(--space-16) w-full"
            >
              링크 만들기
            </Button>
          </>
        )}

        <section className="mt-(--space-32)" aria-label="공유 중인 링크">
          <h3 className="type-label text-ink">공유 중인 링크 {openShares.length}개</h3>
          <ul className="mt-(--space-8) flex flex-col gap-(--space-8)">
            {openShares.map((s) => (
              <li key={s.shareId} className="flex items-center justify-between gap-(--space-8)">
                <span className="type-caption text-ink-2">
                  {new Date(s.createdAt).toLocaleDateString('ko-KR')} 만듦 ·{' '}
                  {Math.max(
                    1,
                    Math.ceil((new Date(s.expiresAt).getTime() - now.getTime()) / DAY_MS),
                  )}
                  일 뒤 닫혀요
                </span>
                <Button
                  type="button"
                  variant="text"
                  trailingIcon={null}
                  onClick={() => void revoke(s.shareId)}
                >
                  공유 끝내기
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
