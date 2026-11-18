'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { Button, Checkbox, Icon } from '@/shared/ui'
import { authApi } from './api'
import { consentNoticeLines } from './consentNotice'
import { clearReturnTo, peekReturnTo } from './oauthSession'
import { HOME_PATH, LOGIN_PATH, loadMe } from './session'
import { useAuthStore } from './store'
import { CONSENT_TYPES, type ConsentDocument, type SignupProfile } from './types'
import { PRIVATE_TEXT } from '@/shared/analytics'
import './auth.css'

/**
 * 가입 토큰이 없거나 만료됐다고 보는 코드.
 * `/auth/signup`은 permitAll이고 가입 토큰은 서비스가 직접 검사해 만료·위조·없음 모두 AUTH_032로 온다
 * (BE `SecurityConfig`·`SignupService`). AUTH_002·AUTH_001은 지금 서버가 이 경로에서 내리지 않지만,
 * 다른 경로를 거쳐 오더라도 같은 안내를 보이도록 남겨 둔다.
 */
const SIGNUP_EXPIRED_CODES: readonly string[] = [
  ErrorCode.SIGNUP_TOKEN_INVALID,
  ErrorCode.ACCESS_TOKEN_EXPIRED,
  ErrorCode.UNAUTHORIZED,
]

export const CONSENT_CHANGED_MESSAGE = '동의 내용이 바뀌었어요. 다시 확인해 주세요.'
export const SAVE_FAILED_MESSAGE = '가입 정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
export const LOAD_FAILED_MESSAGE = '동의서를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'

function sortDocuments(docs: ConsentDocument[]): ConsentDocument[] {
  return [...docs].sort(
    (a, b) => CONSENT_TYPES.indexOf(a.consentType) - CONSENT_TYPES.indexOf(b.consentType),
  )
}

/**
 * SCR-02 가입 동의(Figma 265:1863 Desktop · 265:2033 Mobile).
 *
 * 동의서 4종(API-AUTH-07)을 한 화면에 보여 주고, 모두 동의해야 `가입 완료`(API-AUTH-08)를 누를 수 있다.
 * 가입 토큰(scope=signup)은 메모리에만 있어 새로고침하면 사라진다 → "다시 로그인" 안내.
 *
 * 2026-10-31 새 모양: 흰 카드·회색 요약 상자 없이 줄과 머리카락 선으로만 나누고, "[필수]"는 제목 뒤 작은 표시로
 * 보인다(읽는 이름은 "[필수] 제목" 그대로). 가입 버튼은 화면 아래에 붙인다. 모양은 auth.css의 `.pf-signup*`.
 */
export function SignupConsent() {
  const status = useAuthStore((s) => s.status)
  const router = useRouter()
  // 가입을 마친 폼이 직접 돌아갈 곳으로 보냈다. 그 뒤 회원이 되어 아래 이동이 다시 돌면
  // 돌아갈 경로는 이미 지워져 메인으로 덮어쓰므로 건너뛴다
  const signedUpRef = useRef(false)

  useEffect(() => {
    // 이미 회원이면 이 화면에 있을 이유가 없다
    if (status === 'member' && !signedUpRef.current) router.replace(peekReturnTo() ?? HOME_PATH)
  }, [status, router])

  if (status === 'loading' || status === 'member') return <Notice>확인하는 중이에요…</Notice>
  if (status === 'anonymous') return <SignupExpired />
  return (
    <ConsentForm
      onSignedUp={() => {
        signedUpRef.current = true
      }}
    />
  )
}

function ConsentForm({ onSignedUp }: { onSignedUp: () => void }) {
  const router = useRouter()
  const profile = useAuthStore((s) => s.signupProfile)
  const [docs, setDocs] = useState<ConsentDocument[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const list = await authApi.consentDocuments()
      setDocs(sortDocuments(list))
      setChecked({})
    } catch (e) {
      if (e instanceof ApiError && SIGNUP_EXPIRED_CODES.includes(e.code)) {
        useAuthStore.getState().signOut()
        return
      }
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    // 처음 한 번 동의서를 받는다(외부 API 동기화)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const allChecked = useMemo(
    () => !!docs && docs.length > 0 && docs.every((d) => checked[d.consentDocumentId]),
    [docs, checked],
  )
  const requiredDone = useMemo(
    () =>
      !!docs && docs.length > 0 && docs.every((d) => !d.required || checked[d.consentDocumentId]),
    [docs, checked],
  )

  function toggleAll(next: boolean) {
    if (!docs) return
    setChecked(Object.fromEntries(docs.map((d) => [d.consentDocumentId, next])))
  }

  async function submit() {
    if (!docs || !requiredDone || submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const session = await authApi.signup({
        consents: docs.map((d) => ({
          consentDocumentId: d.consentDocumentId,
          agreed: !!checked[d.consentDocumentId],
        })),
      })
      // 회원으로 바꾸기 전에 표시한다(바뀌면 위 "이미 회원" 이동이 돌기 때문)
      const to = peekReturnTo() ?? HOME_PATH
      onSignedUp()
      clearReturnTo()
      useAuthStore.getState().signIn(session.accessToken, 'user')
      void loadMe()
      router.replace(to)
    } catch (e) {
      setSubmitting(false)
      if (e instanceof ApiError) {
        if (e.code === ErrorCode.CONSENT_OUTDATED) {
          // 동의서가 새 버전으로 바뀌었다 → 다시 받고 체크를 모두 푼다
          setMessage(CONSENT_CHANGED_MESSAGE)
          await load()
          return
        }
        if (e.code === ErrorCode.CONSENT_INCOMPLETE) {
          setMessage(e.message)
          return
        }
        if (SIGNUP_EXPIRED_CODES.includes(e.code)) {
          // 가입 시간(10분)이 지났다 → 다시 로그인
          useAuthStore.getState().signOut()
          return
        }
      }
      // COMMON_999·네트워크 오류: 재시도 안내. 메인으로 보내지 않는다(FN-AUTH-05 예외)
      setMessage(SAVE_FAILED_MESSAGE)
    }
  }

  function decline() {
    // 명시적 거절: API를 부르지 않고 가입 토큰을 버린 뒤 로그인 화면으로(API-AUTH-08 비고)
    useAuthStore.getState().signOut()
    router.replace(LOGIN_PATH)
  }

  return (
    <div className="pf-signup">
      <SignupSteps />
      <h1>가입 전에 확인해요</h1>
      <p className="pf-signup-lead">필수 항목에 동의하면 바로 가입돼요.</p>

      {profile ? <AccountRow profile={profile} /> : null}

      <div className="pf-signup-list">
        {docs === null ? (
          loadError ? (
            <div className="flex flex-col items-start gap-(--space-8) py-(--space-16)">
              <p role="alert" className="type-kr-body-13-regular-lh16p9 text-text-body">
                {LOAD_FAILED_MESSAGE}
              </p>
              <Button variant="text" onClick={() => void load()} trailingIcon={null}>
                다시 불러오기
              </Button>
            </div>
          ) : (
            <p
              role="status"
              className="py-(--space-16) type-kr-body-13-regular-lh16p9 text-text-body"
            >
              동의서를 불러오는 중이에요…
            </p>
          )
        ) : (
          <>
            <div className="pf-signup-all" data-done={allChecked || undefined}>
              <Checkbox
                className="flex-1 text-[17px] font-semibold tracking-[-0.015em] text-text-ink"
                checked={allChecked}
                onChange={(e) => toggleAll(e.currentTarget.checked)}
              >
                전체 동의
              </Checkbox>
              {/* 몇 개에 동의했는지(다 채우면 잉크로) */}
              <span className="pf-signup-count" aria-live="polite">
                {docs.filter((d) => checked[d.consentDocumentId]).length}/{docs.length}
              </span>
            </div>
            <ul className="flex flex-col pt-(--space-6)">
              {docs.map((doc) => (
                <ConsentRow
                  key={doc.consentDocumentId}
                  doc={doc}
                  checked={!!checked[doc.consentDocumentId]}
                  onChange={(next) =>
                    setChecked((prev) => ({ ...prev, [doc.consentDocumentId]: next }))
                  }
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* 가입 버튼은 화면 아래에 붙는다(목록이 길어도 늘 보이게) */}
      <div className="pf-signup-dock">
        {message ? (
          <p role="alert" className="text-[13px] leading-[1.5] text-status-danger">
            {message}
          </p>
        ) : null}
        <Button
          variant="ink"
          className="pf-signup-submit w-full"
          disabled={!requiredDone || submitting}
          aria-busy={submitting}
          onClick={() => void submit()}
        >
          {submitting ? '가입하는 중…' : '가입 완료'}
        </Button>
        <button type="button" onClick={decline} className="pf-signup-decline">
          동의하지 않고 나가기
        </button>
      </div>

      <p className="pf-signup-foot">
        가입 후 내 정보에서 동의 내용과 기록을 언제든 확인할 수 있어요.
      </p>
    </div>
  )
}

/** 로그인 → 동의 → 시작. 지금은 동의 단계(가는 막대 셋, 지난·지금 단계는 잉크) */
function SignupSteps() {
  const steps = ['로그인', '동의', '시작'] as const
  return (
    <ol className="pf-signup-steps" aria-label="가입 단계">
      {steps.map((label, index) => (
        <li
          key={label}
          data-state={index < 1 ? 'done' : index === 1 ? 'current' : 'next'}
          aria-current={index === 1 ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}

const PROVIDER_LABEL: Record<SignupProfile['provider'], string> = {
  KAKAO: '카카오 계정',
  GOOGLE: 'Google 계정',
}

function AccountRow({ profile }: { profile: SignupProfile }) {
  const parts = [PROVIDER_LABEL[profile.provider], profile.nickname, profile.maskedEmail].filter(
    Boolean,
  )
  return (
    <div className="pf-signup-account">
      <Icon name="User" size={15} className="shrink-0 text-text-muted" />
      <p {...PRIVATE_TEXT}>{parts.join(' · ')}</p>
    </div>
  )
}

function ConsentRow({
  doc,
  checked,
  onChange,
}: {
  doc: ConsentDocument
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const notice = consentNoticeLines(doc)
  const tag = doc.required ? '필수' : '선택'
  return (
    <li className={notice.length > 0 ? 'pb-(--space-12)' : undefined}>
      <div className="flex min-h-[48px] items-center gap-(--space-12)">
        <Checkbox
          className="flex-1 text-[14.5px] text-text-ink"
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          // 읽는 이름은 "[필수] 제목", 보이는 모양은 제목 뒤 작은 표시
          aria-label={`[${tag}] ${doc.title}`}
        >
          {doc.title}
          <span aria-hidden className="pf-signup-tag" data-required={doc.required || undefined}>
            {tag}
          </span>
        </Checkbox>
        {/* 전문 보기: 새 창으로 연다. 화면 안 모달로 보여 줄지는 디자인 시스템 2 Modal이 나온 뒤 정한다 */}
        <a
          href={doc.contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${doc.title} 전문 보기 (새 창)`}
          className="flex min-h-[44px] shrink-0 items-center gap-(--space-2) text-[13px] text-text-muted transition-colors duration-150 hover:text-text-ink"
        >
          보기
          <Icon name="CaretRight" size={14} />
        </a>
      </div>
      {notice.length > 0 ? (
        // 고지 요약(FN-AUTH-03): 상자 대신 왼쪽 가는 선, "수집:" 같은 머리말은 진하게
        <ul className="pf-signup-notice">
          {notice.map((line) => {
            const at = line.indexOf(': ')
            return (
              <li key={line}>
                {at > 0 && at < 8 ? (
                  <>
                    <strong>{line.slice(0, at)}</strong>
                    <span>{line.slice(at + 2)}</span>
                  </>
                ) : (
                  <span>{line}</span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="py-(--space-40) text-center type-kr-body-13-regular-lh16p9 text-text-body"
    >
      {children}
    </p>
  )
}

/** 가입 토큰이 없다: 새로고침했거나 10분이 지났거나 로그인 없이 들어왔다 */
function SignupExpired() {
  return (
    <div className="mx-auto flex w-full max-w-[520px] flex-col items-center gap-(--space-16) px-(--space-20) py-(--space-40) text-center">
      <p role="alert" className="text-[17px] font-semibold tracking-[-0.02em] text-text-ink">
        가입 시간이 지났어요. 다시 로그인해 주세요.
      </p>
      <Button variant="ink" href={LOGIN_PATH} className="w-full">
        다시 로그인
      </Button>
    </div>
  )
}
