'use client'

import { useCallback, useEffect, useState } from 'react'
import { authApi } from '@/features/auth/api'
import { endSessionAfterWithdrawal } from '@/features/auth/session'
import { useAuthStore } from '@/features/auth/store'
import type { ConsentRecord, Me } from '@/features/auth/types'
import { useLogout } from '@/features/auth/useLogout'
import { Button, toast } from '@/shared/ui'
import { accountApi } from './api'
import { summarizeConsents, formatDate, PROVIDER_LABEL } from './consentSummary'
import { MattermostNotify } from './MattermostNotify'
import { useMattermostNotifyAvailable } from './mattermostAvailability'
import { ActionRow, LoadError, Loading, PageColumn, PageTitle, Row, Section, Switch } from './ui'
import { WithdrawAccountModal } from './WithdrawAccountModal'
import { PRIVATE_TEXT } from '@/shared/analytics'

export const CONSENTS_PATH = '/me/consents'
export const ME_LOAD_FAILED = '내 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
export const CONSENTS_LOAD_FAILED = '동의 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
/** 동의는 개별로 거둘 수 없다. 거두려면 탈퇴한다(API-AUTH-11 — 유예 없는 하드 삭제) */
export const WITHDRAW_TO_REVOKE =
  '동의를 거두려면 아래 회원 탈퇴를 해 주세요. 탈퇴하면 모든 데이터가 삭제돼요.'
export const CONSENTS_INCOMPLETE = '동의 기록 일부를 찾지 못했어요. 잠시 후 다시 확인해 주세요.'

type Load<T> = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; data: T }

/**
 * SCR-12 내 정보·설정(Figma 265:1942 Desktop · 265:2112 Mobile). 헤더 프로필 버튼으로 들어온다.
 *
 * - 계정: API-AUTH-05(`/users/me`) — 로그인 계정·마스킹 이메일·가입일
 * - 알림: 알림 설정 API가 명세서 v3.1에 없다. 자리만 두고 끈다(알림 기능 S15P31B204-306).
 *   그 아래 Mattermost 완료 알림 등록(S15P31B204-476)
 * - 동의: API-AUTH-09 요약 → SCR-03 동의 기록. 동의 4종은 모두 가입 필수라 개별 철회가 없다(2026-10-26 결정).
 *   동의를 거두려면 회원 탈퇴(SCR-14)를 한다. 철회 API-AUTH-10은 1차에서 쓰지 않는다
 * - 내 데이터: `/users/me`의 dataSummary
 * - 로그아웃(API-AUTH-04), 회원 탈퇴 SCR-14(API-AUTH-11)
 *
 * `(app)` 레이아웃의 AuthGate가 회원만 들여보낸다.
 */
export function AccountPage() {
  const [me, setMe] = useState<Load<Me>>({ kind: 'loading' })
  const [consents, setConsents] = useState<Load<ConsentRecord[]>>({ kind: 'loading' })
  const mattermostAvailable = useMattermostNotifyAvailable()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const { logout, pending: loggingOut } = useLogout()

  const loadMe = useCallback(async () => {
    setMe({ kind: 'loading' })
    try {
      const data = await authApi.me()
      setMe({ kind: 'ok', data })
      // 헤더 닉네임도 같은 값으로 맞춘다
      useAuthStore.getState().setMe(data)
    } catch {
      setMe({ kind: 'error' })
    }
  }, [])

  const loadConsents = useCallback(async () => {
    setConsents({ kind: 'loading' })
    try {
      setConsents({ kind: 'ok', data: await accountApi.consents() })
    } catch {
      setConsents({ kind: 'error' })
    }
  }, [])

  useEffect(() => {
    // 처음 한 번 서버 상태를 받는다(외부 API 동기화)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMe()
    void loadConsents()
  }, [loadMe, loadConsents])

  function onAccountWithdrawn() {
    // 서버가 refresh를 폐기했다. 이 기기의 토큰·회원 상태를 비우고 메인으로(AuthGate)
    endSessionAfterWithdrawal()
    toast('탈퇴했어요. 그동안 이용해 주셔서 고마워요.')
  }

  const summary = consents.kind === 'ok' ? summarizeConsents(consents.data) : null

  return (
    <PageColumn>
      <PageTitle title="내 정보" />
      {/* 누구의 정보인지 먼저 보이게 머리글자 원과 닉네임을 둔다(2026-10-30). 이메일·날짜는 아래 계정 줄에만.
          머리글자 원은 잉크로 채워 화면의 기준점으로 둔다(2026-10-31) */}
      {me.kind === 'ok' ? (
        <div className="mt-(--space-28) flex items-center gap-(--space-16)" {...PRIVATE_TEXT}>
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-text-ink text-[24px] font-semibold text-text-on-dark"
          >
            {(me.data.nickname ?? '회원').slice(0, 1)}
          </span>
          <span className="flex min-w-0 flex-col gap-(--space-4)">
            <span className="truncate text-[20px] font-semibold tracking-[-0.02em] text-text-ink">
              {me.data.nickname ?? '회원'}님
            </span>
            <span className="text-[13.5px] text-text-muted">Preface 회원</span>
          </span>
        </div>
      ) : null}

      <div className="mt-(--space-40) flex flex-col gap-(--space-32)">
        <Section label="계정" description="로그인한 계정이에요.">
          {me.kind === 'ok' ? (
            <>
              <Row label="로그인 계정">
                <span {...PRIVATE_TEXT}>
                  {[me.data.providers.map((p) => PROVIDER_LABEL[p]).join('·'), me.data.nickname]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Row>
              <Row label="이메일">
                <span {...PRIVATE_TEXT}>{me.data.maskedEmail ?? '없음'}</span>
              </Row>
              <Row label="가입일">
                <span {...PRIVATE_TEXT}>{formatDate(me.data.createdAt)}</span>
              </Row>
            </>
          ) : me.kind === 'error' ? (
            <LoadError message={ME_LOAD_FAILED} onRetry={() => void loadMe()} />
          ) : (
            <Loading>내 정보를 불러오는 중이에요…</Loading>
          )}
        </Section>

        <Section label="알림" description="3D가 완성되면 알려 드려요.">
          {/* 알림 설정 API가 아직 없다(명세서 v3.1). 알림은 모두 받는 상태로 두고 바꾸지 못하게 한다 */}
          <div className="flex items-center justify-between gap-(--space-16) py-(--space-10)">
            <div className="flex flex-col gap-(--space-2)">
              <span className="text-[14.5px] font-medium text-text-ink">알림 설정</span>
              <span className="text-[12.5px] text-text-muted">알림 끄기는 준비 중이에요.</span>
            </div>
            <Switch checked disabled label="알림 설정" />
          </div>
          {/* 처리방침 2026-12-v1 시행 전에는 운영에서 숨긴다(-517) */}
          {me.kind === 'ok' && mattermostAvailable ? (
            <MattermostNotify
              username={me.data.mattermostUsername ?? null}
              onChange={(mattermostUsername) => {
                const data = { ...me.data, mattermostUsername }
                setMe({ kind: 'ok', data })
                useAuthStore.getState().setMe(data)
              }}
            />
          ) : null}
        </Section>

        <Section label="동의" description="가입할 때 동의한 내용이에요.">
          {consents.kind === 'ok' && summary ? (
            summary.complete ? (
              <div className="flex flex-col gap-(--space-4) py-(--space-14)">
                <span className="text-[14.5px] font-medium text-text-ink">
                  가입 동의 {consents.data.length}종
                </span>
                <span className="text-[12.5px] text-text-muted tabular-nums">{summary.line}</span>
              </div>
            ) : (
              <LoadError message={CONSENTS_INCOMPLETE} onRetry={() => void loadConsents()} />
            )
          ) : consents.kind === 'error' ? (
            <LoadError message={CONSENTS_LOAD_FAILED} onRetry={() => void loadConsents()} />
          ) : (
            <Loading>동의 기록을 불러오는 중이에요…</Loading>
          )}
          <ActionRow href={CONSENTS_PATH}>동의 내용·기록 보기</ActionRow>
          <p className="py-(--space-14) text-[12.5px] leading-[1.55] break-keep text-text-muted">
            {WITHDRAW_TO_REVOKE}
          </p>
        </Section>

        <Section label="내 데이터" description="지금 보관 중인 3D와 시안이에요.">
          {me.kind === 'ok' ? (
            <>
              <Row label="내 모델">{me.data.dataSummary.faceModelCount}개</Row>
              <Row label="시안">{me.data.dataSummary.simulationCount}개</Row>
            </>
          ) : (
            <Row label="내 모델·시안">{me.kind === 'error' ? '-' : '…'}</Row>
          )}
        </Section>
        {/* 로그아웃·탈퇴: 같은 두 칸 구성의 마지막 줄. 탈퇴만 위험 색 */}
        <div className="grid gap-x-(--space-40) gap-y-(--space-12) border-t border-line-default pt-(--space-24) md:grid-cols-[200px_minmax(0,1fr)]">
          <div aria-hidden className="hidden md:block" />
          <div className="flex flex-wrap items-center justify-between gap-(--space-12)">
            <Button
              variant="secondary"
              layout="icon-first"
              className="w-full sm:w-auto"
              onClick={() => void logout()}
              disabled={loggingOut}
              aria-busy={loggingOut}
            >
              {loggingOut ? '로그아웃하는 중…' : '로그아웃'}
            </Button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              disabled={me.kind !== 'ok'}
              className="mx-auto min-h-[44px] cursor-pointer px-(--space-8) text-[13.5px] font-medium text-status-danger disabled:cursor-not-allowed disabled:opacity-40 sm:mx-0"
            >
              회원 탈퇴
            </button>
          </div>
        </div>
      </div>

      {me.kind === 'ok' ? (
        <WithdrawAccountModal
          open={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          onWithdrawn={onAccountWithdrawn}
          dataSummary={me.data.dataSummary}
        />
      ) : null}
    </PageColumn>
  )
}
