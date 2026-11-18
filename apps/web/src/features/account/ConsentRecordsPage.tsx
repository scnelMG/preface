'use client'

import { useCallback, useEffect, useState } from 'react'
import { authApi } from '@/features/auth/api'
import { consentNoticeLines } from '@/features/auth/consentNotice'
import { CONSENT_TYPES, type ConsentDocument, type ConsentRecord } from '@/features/auth/types'
import { Icon } from '@/shared/ui'
import { accountApi } from './api'
import { recordLine, sortRecords } from './consentSummary'
import Link from 'next/link'
import { Card, LoadError, Loading, PageColumn, PageTitle } from './ui'

export const ME_PATH = '/me'
export const RECORDS_LOAD_FAILED = '동의 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
export const RECORDS_INCOMPLETE = '동의 기록 일부를 찾지 못했어요. 잠시 후 다시 확인해 주세요.'

interface Loaded {
  records: ConsentRecord[]
  /** 동의서(API-AUTH-07). 전문 링크·고지 요약용이라 못 받아도 기록은 보여 준다 */
  documents: ConsentDocument[]
}

/**
 * SCR-03 동의 내용·기록 보기(읽기 전용). Figma 266:1858 Desktop · 266:2231 Mobile은 SCR-12 위 모달이지만
 * 이슈 체크리스트대로 `/me/consents` 화면으로 둔다.
 *
 * - 기록: API-AUTH-09 — 종류별 마지막 기록(동의·철회 시각, 버전, 시행일). 새로 철회하는 기능은 없지만
 *   이전에 철회한 기록은 그대로 보여 준다
 * - 전문 보기·고지 요약: API-AUTH-07 지금 시행본의 `contentUrl`·`summary`.
 *   전문 페이지(`/legal/...`)는 아직 없다 — 링크만 둔다
 */
export function ConsentRecordsPage() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error' } | ({ kind: 'ok' } & Loaded)
  >({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const [records, documents] = await Promise.allSettled([
      accountApi.consents(),
      authApi.consentDocuments(),
    ])
    if (records.status === 'rejected') {
      setState({ kind: 'error' })
      return
    }
    setState({
      kind: 'ok',
      records: sortRecords(records.value),
      documents: documents.status === 'fulfilled' ? documents.value : [],
    })
  }, [])

  useEffect(() => {
    // 처음 한 번 서버 상태를 받는다(외부 API 동기화)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <PageColumn>
      {/* 돌아가기는 제목 위 한 줄(2026-10-31) */}
      <Link
        href={ME_PATH}
        aria-label="내 정보로 돌아가기"
        className="group mb-(--space-16) -ml-(--space-4) flex min-h-[40px] w-fit items-center gap-(--space-4) px-(--space-4) text-[13.5px] font-medium text-text-paragraph transition-colors duration-150 hover:text-text-ink"
      >
        <Icon
          name="CaretLeft"
          size={15}
          className="transition-transform duration-150 group-hover:-translate-x-0.5"
        />
        내 정보
      </Link>
      <PageTitle
        title="동의 내용·기록"
        description="가입할 때 동의한 내용이에요. 동의는 하나씩 거둘 수 없고, 거두려면 회원 탈퇴를 해 주세요."
      />

      <div className="mt-(--space-32)">
        {state.kind === 'ok' ? (
          <Records records={state.records} documents={state.documents} onRetry={load} />
        ) : (
          <Card>
            {state.kind === 'error' ? (
              <LoadError message={RECORDS_LOAD_FAILED} onRetry={() => void load()} />
            ) : (
              <Loading>동의 기록을 불러오는 중이에요…</Loading>
            )}
          </Card>
        )}
      </div>
    </PageColumn>
  )
}

function Records({
  records,
  documents,
  onRetry,
}: Loaded & {
  onRetry: () => Promise<void>
}) {
  const docByType = new Map(documents.map((d) => [d.consentType, d]))
  const complete = CONSENT_TYPES.every((t) => records.some((r) => r.consentType === t))
  const faceDoc = docByType.get('FACE_DATA')
  const notice = faceDoc ? consentNoticeLines(faceDoc) : []

  return (
    <div className="flex flex-col gap-(--space-32)">
      {complete ? null : (
        <Card>
          <LoadError message={RECORDS_INCOMPLETE} onRetry={() => void onRetry()} />
        </Card>
      )}
      {/* 상자 없는 줄 목록(위아래 머리카락 선). 상태는 색만이 아니라 아이콘 + 글(동의함·철회함)로 함께 알린다 */}
      <ul
        aria-label="내 동의 기록"
        className="flex flex-col divide-y divide-line-default border-y border-line-default"
      >
        {records.map((record) => {
          const doc = docByType.get(record.consentType)
          return (
            <li
              key={record.consentType}
              className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-(--space-12) gap-y-(--space-2) py-(--space-18)"
            >
              <Icon
                name={record.status === 'AGREED' ? 'CheckCircle' : 'Info'}
                size={20}
                aria-hidden
                className="mt-[12px] text-text-ink"
              />
              <div className="flex items-center justify-between gap-(--space-16)">
                <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-text-ink">
                  {record.title}
                </h2>
                {doc ? (
                  <a
                    href={doc.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${record.title} 전문 보기 (새 창)`}
                    className="flex min-h-[44px] shrink-0 items-center gap-(--space-2) text-[13px] text-text-muted transition-colors duration-150 hover:text-text-ink"
                  >
                    전문 보기
                    <Icon name="CaretRight" size={14} />
                  </a>
                ) : null}
              </div>
              <p className="col-start-2 text-[13px] leading-relaxed text-text-muted tabular-nums">
                {recordLine(record)}
              </p>
            </li>
          )
        })}
      </ul>
      {notice.length > 0 ? (
        // 고지 요약: 가입 동의 화면과 같은 모양(상자 대신 왼쪽 가는 선)
        <section className="flex flex-col gap-(--space-10)">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-text-ink">
            얼굴 데이터는 이렇게 다뤄요
          </h2>
          <ul
            aria-label="얼굴 데이터 수집·이용 요약"
            className="flex flex-col gap-(--space-6) border-l border-[var(--pf-hairline-strong)] pl-(--space-16) text-[13px] leading-[1.6] break-keep text-text-paragraph"
          >
            {notice.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
