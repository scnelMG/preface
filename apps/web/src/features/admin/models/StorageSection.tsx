'use client'

import { useEffect, useState } from 'react'
import { PRIVATE_TEXT } from '@/shared/analytics'
import { cx } from '@/shared/ui'
import { adminModelsApi } from './api'
import { adminErrorMessage } from './errors'
import { formatBytes, formatDateTime } from './format'
import type { AdminUserStorage, StorageObjectState } from './types'

export const NO_OBJECTS = '이 사용자 경로에 객체가 없어요'
export const NO_DELETION_FAILURES = '삭제 실패 기록이 없어요'
export const TRUNCATED_NOTICE =
  '파일이 많아 앞의 2000개만 확인했어요. 그 뒤 파일은 DB에만 있는지 확인하지 못했어요.'

const SOURCE_LABEL: Record<string, string> = {
  FACE_UPLOAD: '업로드 영상',
  FACE_UPLOAD_FRAMES: '추출 프레임',
  FACE_MODEL: '3D 모델',
  FACE_CAPTURE_IMAGE: '촬영 사진',
  JOB_STAGE_LOG: '단계 로그',
  DELETION_LOG: '삭제 대기 기록',
}

/** 객체 출처. null은 DB에 기록이 없는 객체(S3에만 있음), 모르는 값은 코드 그대로 */
export function sourceLabel(source: string | null): string {
  if (source === null) return 'DB 기록 없음'
  return SOURCE_LABEL[source] ?? source
}

const STATE: Record<StorageObjectState, { label: string; tone: string }> = {
  OK: { label: '정상', tone: 'bg-bg-stone text-text-body' },
  DB_ONLY: { label: 'DB에만 있음', tone: 'bg-brand-lavender-soft text-brand-violet-text' },
  S3_ONLY: { label: 'S3에만 있음', tone: 'bg-brand-lavender-soft text-brand-violet-text' },
  DELETE_FAILED: { label: '삭제 실패', tone: 'bg-bg-cream text-status-danger' },
}

export function StorageStateBadge({ state }: { state: StorageObjectState }) {
  const spec = STATE[state] ?? { label: state, tone: 'bg-bg-stone text-text-body' }
  return (
    <span
      data-state={state}
      title={state}
      className={cx(
        'type-kr-caption-11-medium-lh14p3 inline-flex items-center rounded-full px-(--space-8) py-(--space-2) whitespace-nowrap',
        spec.tone,
      )}
    >
      {spec.label}
    </span>
  )
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AdminUserStorage }

/** 계약 8. 사용자 한 명의 S3 prefix 객체와 삭제 실패. 표는 모바일에서 가로로 스크롤한다 */
export function StorageSection({ userId }: { userId: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    adminModelsApi
      .storage(userId)
      .then((data) => alive && setLoad({ status: 'ready', data }))
      .catch(
        (error: unknown) =>
          alive &&
          setLoad({ status: 'error', message: adminErrorMessage(error, '저장소 목록을', true) }),
      )
    return () => {
      alive = false
    }
  }, [userId, attempt])

  function reload() {
    setLoad({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  return (
    <section className="flex flex-col gap-(--space-16)" aria-labelledby="admin-storage-title">
      <div className="flex flex-wrap items-baseline justify-between gap-(--space-8)">
        <h2
          id="admin-storage-title"
          className="type-kr-heading-15-medium-ls-0p5-lh19p5 text-text-ink"
        >
          S3 저장소
        </h2>
        {load.status === 'ready' ? (
          <p className="type-caption text-text-muted">
            <span {...PRIVATE_TEXT}>{load.data.prefix}</span> ·{' '}
            {formatDateTime(load.data.checkedAt)} 확인
          </p>
        ) : null}
      </div>

      {load.status === 'loading' ? (
        <p className="type-caption text-text-muted" role="status">
          저장소 목록을 불러오는 중이에요
        </p>
      ) : load.status === 'error' ? (
        <div className="flex items-center gap-(--space-12)">
          <p className="type-kr-body-13-regular-lh16p9 text-status-danger" role="alert">
            {load.message}
          </p>
          <button type="button" onClick={reload} className="type-label text-text-ink underline">
            다시 시도
          </button>
        </div>
      ) : (
        <>
          {load.data.truncated ? (
            <p className="type-kr-body-13-regular-lh16p9 text-status-danger" role="note">
              {TRUNCATED_NOTICE}
            </p>
          ) : null}
          {load.data.objects.length === 0 ? (
            <p className="type-kr-body-13-regular-lh16p9 text-text-muted">{NO_OBJECTS}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-left">
                <thead>
                  <tr className="type-kr-caption-11-medium-lh14p3 border-b border-line-default text-text-muted">
                    <th className="py-(--space-8) pr-(--space-16) font-medium">키</th>
                    <th className="py-(--space-8) pr-(--space-16) font-medium">크기</th>
                    <th className="py-(--space-8) pr-(--space-16) font-medium">마지막 수정</th>
                    <th className="py-(--space-8) pr-(--space-16) font-medium">출처</th>
                    <th className="py-(--space-8) pr-(--space-16) font-medium">삭제 예정</th>
                    <th className="py-(--space-8) font-medium">상태</th>
                  </tr>
                </thead>
                <tbody className="type-kr-body-12-regular-lh15p6 text-text-body">
                  {load.data.objects.map((object) => (
                    <tr key={object.key} className="border-b border-line-default">
                      <td {...PRIVATE_TEXT} className="py-(--space-8) pr-(--space-16) font-mono">
                        {object.key}
                      </td>
                      <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                        {formatBytes(object.size)}
                      </td>
                      <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                        {formatDateTime(object.lastModified)}
                      </td>
                      <td
                        className="py-(--space-8) pr-(--space-16)"
                        title={object.source ?? undefined}
                      >
                        {sourceLabel(object.source)}
                      </td>
                      <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                        {formatDateTime(object.deleteScheduledAt)}
                      </td>
                      <td className="py-(--space-8)">
                        <StorageStateBadge state={object.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-(--space-8)">
            <h3 className="type-label text-text-ink">삭제 실패</h3>
            {load.data.deletionFailures.length === 0 ? (
              <p className="type-kr-body-13-regular-lh16p9 text-text-muted">
                {NO_DELETION_FAILURES}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-left">
                  <thead>
                    <tr className="type-kr-caption-11-medium-lh14p3 border-b border-line-default text-text-muted">
                      <th className="py-(--space-8) pr-(--space-16) font-medium">객체 키</th>
                      <th className="py-(--space-8) pr-(--space-16) font-medium">사유</th>
                      <th className="py-(--space-8) font-medium">재시도</th>
                    </tr>
                  </thead>
                  <tbody className="type-kr-body-12-regular-lh15p6 text-text-body">
                    {load.data.deletionFailures.map((failure) => (
                      <tr key={failure.objectKey} className="border-b border-line-default">
                        <td {...PRIVATE_TEXT} className="py-(--space-8) pr-(--space-16) font-mono">
                          {failure.objectKey}
                        </td>
                        <td className="py-(--space-8) pr-(--space-16)">{failure.reason ?? '—'}</td>
                        <td className="py-(--space-8) tabular-nums">{failure.retryCount}회</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
