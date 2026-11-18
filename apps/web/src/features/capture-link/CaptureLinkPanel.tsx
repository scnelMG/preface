'use client'

import { useState, type ReactNode } from 'react'
import { CaptureSequenceImage } from '@/features/capture-guide/CaptureSequenceImage'
import {
  CAPTURE_SEQUENCE,
  MOBILE_CAPTURE_GUIDE,
  MOBILE_CAPTURE_PREPARATION,
} from '@/features/capture-guide/guideContent'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { Button, cx, Icon, toast, Tooltip } from '@/shared/ui'
import { qrUrlForPage } from '@/features/capture/linkToken'
import { QrCode } from './QrCode'
import type { CaptureLinkView } from './useCaptureLink'

/**
 * SCR-16 QR 휴대폰 연결(PC) — Figma `Wireframe v3.2 최종` › `SCR-16 촬영 가이드 모달 · QR 휴대폰 연결 (PC) / Desktop`.
 * 모달 본문만 그린다. 모달 틀(제목·닫기)은 부르는 쪽이 `Modal`로 감싼다.
 *
 * Figma에는 "연결을 기다리는 중" 한 장면만 있다. 연결됨·만료·끊김·업로드 완료·발급 실패는
 * 같은 상태 상자 자리에 문구와 버튼을 바꿔 넣었다.
 * 휴대폰이 연결되면 QR은 더 쓸 일이 없어, 그 자리에 휴대폰 촬영 화면(SCR-05)과 같은 촬영 가이드를 보인다(S15P31B204-450).
 */

const STEPS = [
  '휴대폰 카메라로 QR을 찍어요',
  '휴대폰에서 안내대로 촬영해요',
  '업로드가 끝나면 이 화면이 자동으로 넘어가요',
] as const

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface CaptureLinkPanelProps {
  variant?: 'panel' | 'page'
  view: CaptureLinkView
  onRegenerate: () => void
  onDisconnect: () => Promise<void>
}

export function CaptureLinkPanel({
  view,
  onRegenerate,
  onDisconnect,
  variant = 'panel',
}: CaptureLinkPanelProps) {
  if (view.kind === 'failed')
    return (
      <div className={variant === 'page' ? 'pf-capture-link-page' : undefined}>
        <IssueFailed error={view.error} onRetry={onRegenerate} />
      </div>
    )

  const status = view.kind === 'ready' ? view.status : null
  // 지금 진행 중인 단계(1~3). 강조만 바꾼다
  // Figma(기다리는 중)에서는 세 번호가 같은 모양이다. 연결된 뒤에만 지금 단계를 진하게 칠한다
  const currentStep = status === 'CONNECTED' ? 2 : status === 'UPLOADED' ? 3 : null

  if (variant === 'page') {
    return (
      <div className="pf-capture-link-page">
        {/* QR 왼쪽, 오른쪽 한 칸에 제목·설명·연결 상태·안내를 모은다(아래로 줄을 늘리지 않게, 2026-10-31) */}
        <div className="pc-connection">
          <QrCard view={view} compact onRegenerate={onRegenerate} />
          <div className="pc-connection-body">
            {/* 제목·설명은 상태마다 맞춘다(만료·끊김에서도 '찍어 연결하세요'가 남지 않게, 2026-10-31) */}
            <h2>
              {status === 'CONNECTED'
                ? '휴대폰이 연결됐어요.'
                : status === 'UPLOADED'
                  ? '촬영 영상이 도착했어요.'
                  : status === 'EXPIRED'
                    ? '새 QR이 필요해요.'
                    : status === 'CANCELED'
                      ? '다시 연결해 주세요.'
                      : 'QR을 찍어 연결하세요.'}
            </h2>
            <p>
              {status === 'CONNECTED'
                ? '휴대폰에서 촬영 안내를 확인하세요.'
                : status === 'UPLOADED'
                  ? '3D 모델 생성 화면으로 이동해요.'
                  : status === 'EXPIRED' || status === 'CANCELED'
                    ? '새 QR을 만들어 휴대폰으로 다시 찍어 주세요.'
                    : '휴대폰 기본 카메라로 찍으면 바로 이어져요.'}
            </p>
            <StatusBox view={view} onRegenerate={onRegenerate} onDisconnect={onDisconnect} />
            {status === 'WAITING' || status === null ? (
              <p className="pc-demo-note">
                QR은 본인만 사용하세요. 3분 뒤 만료되고 한 번만 쓸 수 있어요.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <p className="type-kr-body-13-regular-lh16p9 text-text-body">
        PC에서는 영상을 올리지 않아요. 휴대폰으로 QR을 찍어 촬영을 이어가세요.
      </p>

      {status === 'CONNECTED' ? (
        <ConnectedGuide />
      ) : (
        <div className="mt-(--space-18) flex flex-col items-center gap-(--space-16) md:flex-row">
          <QrCard view={view} onRegenerate={onRegenerate} />
          <ol className="flex flex-col gap-(--space-14)" aria-label="연결 순서">
            {STEPS.map((text, index) => {
              const step = index + 1
              const active = step === currentStep
              return (
                <li
                  key={text}
                  className="flex items-start gap-(--space-10)"
                  aria-current={active ? 'step' : undefined}
                >
                  <span
                    className={cx(
                      'type-en-caption-10-regular-lh13 flex size-6 shrink-0 items-center justify-center rounded-full',
                      active
                        ? 'bg-brand-violet text-text-on-dark'
                        : 'bg-brand-lavender-tint text-brand-violet-ink',
                    )}
                  >
                    {step}
                  </span>
                  <span className="type-kr-body-13-regular-lh16p9 pt-(--space-4) text-text-ink">
                    {text}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      <div className="mt-(--space-18)">
        <StatusBox view={view} onRegenerate={onRegenerate} onDisconnect={onDisconnect} />
      </div>

      <p className="type-kr-caption-11-regular-lh14p3 mt-(--space-14) flex items-center gap-(--space-8) text-text-muted">
        <Icon name="ShieldCheck" size={14} className="shrink-0" />
        QR은 본인만 사용하세요. 3분 뒤 만료되고 한 번만 쓸 수 있어요.
      </p>
    </div>
  )
}

/**
 * 연결된 뒤 PC에서도 보는 촬영 가이드. 휴대폰 화면과 같은 순서 그림·순서·준비 안내(`guideContent`)를 쓴다.
 * 이 모달은 1440×900·1920×1080에서 스크롤 없이 들어가야 해서(촬영 가이드 모달과 같은 약속) 그림을 옆에 두고 글을 작게 둔다.
 */
function ConnectedGuide() {
  return (
    <section
      aria-label="촬영 가이드"
      className="mt-(--space-18) flex flex-col gap-(--space-16) md:flex-row md:items-start"
    >
      <figure className="w-full shrink-0 overflow-hidden rounded-8 bg-bg-stone md:w-60">
        <CaptureSequenceImage />
        <figcaption className="type-kr-caption-11-regular-lh16p5 border-t border-line-stone px-(--space-12) py-(--space-8) break-keep text-text-body">
          {CAPTURE_SEQUENCE.steps.join(' → ')}
        </figcaption>
      </figure>
      <div className="flex min-w-0 flex-col">
        <h3 className="type-kr-body-12-medium-lh15p6 text-text-body">
          {MOBILE_CAPTURE_GUIDE.preparationLabel}
        </h3>
        <ul
          aria-label={MOBILE_CAPTURE_GUIDE.preparationLabel}
          className="mt-(--space-8) flex flex-col gap-(--space-8)"
        >
          {MOBILE_CAPTURE_PREPARATION.map((item) => (
            <li
              key={item}
              className="type-kr-caption-11-regular-lh14p3 flex items-start gap-(--space-8) break-keep text-text-ink"
            >
              <Icon name="Check" size={14} className="shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function QrCard({
  view,
  compact = false,
  onRegenerate,
}: {
  view: CaptureLinkView
  compact?: boolean
  onRegenerate: () => void
}) {
  const ready = view.kind === 'ready' ? view : null
  const status = ready?.status
  const showQr = ready && (status === 'WAITING' || status === 'EXPIRED' || status === 'CANCELED')
  const dimmed = status === 'EXPIRED' || status === 'CANCELED'

  return (
    <div
      className={
        compact
          ? 'pf-capture-qr'
          : 'flex w-47.5 shrink-0 flex-col items-center gap-(--space-10) rounded-8 border border-line-default bg-bg-surface p-(--space-14)'
      }
    >
      <div className={compact ? 'relative size-32' : 'relative size-40'}>
        {showQr ? (
          dimmed ? (
            // 만료·끊김: 뭉갠 QR을 남기지 않고 같은 크기의 빈 칸(고장 난 것처럼 보이지 않게)
            <div className="flex size-full flex-col items-center justify-center gap-(--space-6) rounded-(--pf-radius-md) text-muted-soft shadow-[inset_0_0_0_1px_var(--pf-hairline-strong)]">
              <Icon name="Clock" size={22} />
              <span className="text-[12px]">{status === 'EXPIRED' ? '만료됨' : '연결 끊김'}</span>
            </div>
          ) : (
            <QrCode
              // PC 주소가 ?debug=1이면 휴대폰 촬영 화면도 수치를 보이게 QR에 싣는다(-716)
              value={qrUrlForPage(
                ready.link.qrUrl,
                typeof window === 'undefined' ? '' : window.location.search,
              )}
              size={compact ? 128 : 160}
              label="휴대폰 연결 QR 코드"
            />
          )
        ) : (
          <div className="flex size-full items-center justify-center rounded-6 bg-bg-warm">
            {status === 'CONNECTED' || status === 'UPLOADED' ? (
              <Icon name="CheckCircle" size={48} className="text-brand-violet" label="연결됨" />
            ) : (
              <span className="type-kr-caption-11-regular-lh14p3 text-text-muted">
                QR을 만드는 중…
              </span>
            )}
          </div>
        )}
      </div>
      {/* 만료·끊김이면 시간 줄은 두지 않는다(빈 칸에 이미 적혀 있다) */}
      {dimmed ? null : (
        <p className="type-kr-body-12-medium-lh15p6 flex items-center gap-(--space-6) text-text-ink">
          <Icon
            name={status === 'CONNECTED' || status === 'UPLOADED' ? 'Check' : 'Clock'}
            size={14}
            className="shrink-0"
          />
          {status === 'WAITING' ? (
            <span>
              남은 시간{' '}
              <time aria-live="off" className="tabular-nums">
                {formatRemaining(ready!.remainingMs)}
              </time>
            </span>
          ) : status === 'CONNECTED' || status === 'UPLOADED' ? (
            <span>연결됨</span>
          ) : dimmed ? (
            <span>만료됨</span>
          ) : (
            <span>남은 시간 3:00</span>
          )}
          {/* 기다리는 동안 언제든 새 QR로 바꾼다(예전 QR은 끊고 새로 발급, 사용자당 1개). 2026-10-30 */}
          {status === 'WAITING' ? (
            // 말풍선: 돌림 화살표만으로는 'QR 새로 만들기'가 안 보인다
            <Tooltip label="QR 새로 만들기">
              {(describedBy) => (
                <button
                  type="button"
                  onClick={onRegenerate}
                  aria-label="QR 새로 만들기"
                  aria-describedby={describedBy}
                  className="-my-(--space-6) inline-flex size-7 items-center justify-center rounded-full text-text-muted transition-[color,background-color,transform] duration-150 hover:bg-ink/5 hover:text-text-ink active:scale-95 [&:active_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:duration-300"
                >
                  <Icon name="ArrowsClockwise" size={14} />
                </button>
              )}
            </Tooltip>
          ) : null}
        </p>
      )}
    </div>
  )
}

/** 상태 줄의 행동: 머리카락 선 알약(다른 화면의 보조 버튼과 같은 결) */
const STATUS_ACTION =
  'inline-flex h-8 shrink-0 items-center gap-(--space-6) rounded-full px-(--space-12) text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--pf-hairline-strong)] transition-colors duration-150 hover:bg-ink/5 enabled:active:scale-[0.96] disabled:opacity-40'

function StatusBox({
  view,
  onRegenerate,
  onDisconnect,
}: {
  view: CaptureLinkView
  onRegenerate: () => void
  onDisconnect: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const status = view.kind === 'ready' ? view.status : null

  const disconnect = async () => {
    setBusy(true)
    try {
      await onDisconnect()
      toast('휴대폰 연결을 끊었어요.')
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : '연결을 끊지 못했어요. 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  switch (status) {
    case 'CONNECTED':
      return (
        <Box
          tone="active"
          message="휴대폰이 연결됐어요. 휴대폰에서 촬영과 업로드를 이어가세요."
          action={
            <button type="button" className={STATUS_ACTION} disabled={busy} onClick={disconnect}>
              연결 끊기
            </button>
          }
        />
      )
    case 'UPLOADED':
      return <Box tone="active" message="업로드가 끝났어요. 3D 생성 화면으로 이동해요." />
    case 'EXPIRED':
    case 'CANCELED':
      return (
        <Box
          tone="idle"
          message={status === 'EXPIRED' ? 'QR이 만료됐어요.' : '휴대폰 연결이 끊겼어요.'}
          action={
            <button type="button" className={STATUS_ACTION} onClick={onRegenerate}>
              <Icon name="ArrowsClockwise" size={14} />
              QR 새로 만들기
            </button>
          }
        />
      )
    case 'WAITING':
      return <Box tone="waiting" message="휴대폰 연결을 기다리고 있어요" />
    default:
      return <Box tone="idle" message="QR을 만들고 있어요" />
  }
}

function Box({
  tone,
  message,
  action,
}: {
  tone: 'waiting' | 'active' | 'idle'
  message: string
  action?: ReactNode
}) {
  return (
    // 상자 없이 한 줄(2026-10-31): 상태 점 + 글 + 행동. 테두리·바탕을 두지 않아 페이지의 다른 글과 같은 결로 보인다
    <div
      role="status"
      className="flex min-h-9 flex-wrap items-center gap-x-(--space-10) gap-y-(--space-6)"
    >
      <span
        aria-hidden
        className={cx(
          'size-2 shrink-0 rounded-full',
          tone === 'idle' ? 'bg-text-muted' : 'bg-brand-violet',
          tone === 'waiting' && 'animate-pulse',
        )}
      />
      <span className="text-[13.5px] leading-snug font-medium whitespace-nowrap text-ink">
        {message}
      </span>
      {action}
    </div>
  )
}

function IssueFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const code = error instanceof ApiError ? error.code : null
  let action: ReactNode
  if (code === ErrorCode.RECONSTRUCTION_IN_PROGRESS) {
    action = (
      <Button variant="ink" href="/studio" className="w-full">
        내 작업실로 가기
      </Button>
    )
  } else if (code === ErrorCode.FACE_CONSENT_MISSING) {
    action = (
      <Button variant="ink" href="/me/consents" className="w-full">
        동의 기록 보기
      </Button>
    )
  } else {
    action = (
      <Button
        variant="ink"
        trailingIcon="ArrowCounterClockwise"
        onClick={onRetry}
        className="w-full"
      >
        다시 시도
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-(--space-20)">
      {code === ErrorCode.RECONSTRUCTION_IN_PROGRESS ? (
        <p className="type-kr-heading-15-medium-ls-0p5-lh19p5 text-text-ink">
          3D는 한 번에 하나만 만들 수 있어요
        </p>
      ) : null}
      <p role="alert" className="type-kr-body-13-regular-lh16p9 text-text-body">
        {error.message}
      </p>
      {action}
    </div>
  )
}
