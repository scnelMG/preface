import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { fail, ok, routeFetch } from '@/features/auth/testUtils'
import type { ConsentDocument, ConsentRecord } from '@/features/auth/types'
import { __resetRefreshState } from '@/shared/api/client'
import { setAccessToken } from '@/shared/api/tokenStore'
import { ConsentRecordsPage, RECORDS_LOAD_FAILED } from './ConsentRecordsPage'

function record(
  consentType: ConsentRecord['consentType'],
  title: string,
  over: Partial<ConsentRecord> = {},
): ConsentRecord {
  return {
    consentType,
    title,
    version: '2026-10-v1',
    effectiveAt: '2026-10-01T00:00:00Z',
    status: 'AGREED',
    agreedAt: '2026-10-19T03:00:00Z',
    withdrawnAt: null,
    isLatestVersion: true,
    ...over,
  }
}

// 서버 순서가 섞여 와도 화면은 TERMS → PRIVACY → FACE_DATA → FACE_PUBLIC
const RECORDS = [
  record('FACE_PUBLIC', '얼굴 공개', {
    status: 'WITHDRAWN',
    withdrawnAt: '2026-10-25T01:00:00Z',
  }),
  record('TERMS', '서비스 이용약관'),
  record('FACE_DATA', '얼굴 데이터 수집·이용', { isLatestVersion: false }),
  record('PRIVACY', '개인정보 수집·이용'),
]

function doc(consentType: ConsentDocument['consentType'], summary: string | null = null) {
  return {
    consentDocumentId: `d-${consentType}`,
    consentType,
    version: '2026-10-v1',
    title: consentType,
    contentUrl: `/legal/${consentType.toLowerCase()}/2026-10-v1`,
    required: true,
    summary,
    effectiveAt: '2026-10-01T00:00:00Z',
  } satisfies ConsentDocument
}

const DOCS = [
  doc('TERMS'),
  doc('PRIVACY'),
  doc('FACE_DATA', '수집: 얼굴 영상 / 목적: 3D 얼굴 생성'),
  doc('FACE_PUBLIC'),
]

beforeEach(() => {
  __resetRefreshState()
  setAccessToken('access-1', 'user')
})

describe('SCR-03 동의 내용·기록', () => {
  it('동의 기록을 순서대로, 읽기 전용으로 보여 준다', async () => {
    routeFetch([
      ['GET', '/users/me/consents', ok(RECORDS)],
      ['GET', '/consent-documents', ok(DOCS)],
    ])
    render(<ConsentRecordsPage />)

    const list = await screen.findByRole('list', { name: '내 동의 기록' })
    const titles = within(list)
      .getAllByRole('heading')
      .map((h) => h.textContent)
    expect(titles).toEqual([
      '서비스 이용약관',
      '개인정보 수집·이용',
      '얼굴 데이터 수집·이용',
      '얼굴 공개',
    ])
    expect(
      within(list).getByText(
        '동의함 · 2026.10.19 · 버전 2026-10-v1 · 시행 2026.10.01 · 새 버전 있음',
      ),
    ).toBeInTheDocument()
    expect(
      within(list).getByText('철회함 · 2026.10.25 · 버전 2026-10-v1 · 시행 2026.10.01'),
    ).toBeInTheDocument()

    // 전문 보기는 새 창 링크. 바꾸는 입력은 없다
    expect(screen.getByRole('link', { name: '서비스 이용약관 전문 보기 (새 창)' })).toHaveAttribute(
      'href',
      '/legal/terms/2026-10-v1',
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    // 서버 summary가 있으면 그대로 나눠 보여 준다
    expect(screen.getByText('수집: 얼굴 영상')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 정보로 돌아가기' })).toHaveAttribute('href', '/me')
  })

  it('동의서를 못 받아도 기록은 보여 준다(전문 링크만 빠진다)', async () => {
    routeFetch([
      ['GET', '/users/me/consents', ok(RECORDS)],
      ['GET', '/consent-documents', fail(500, 'COMMON_999')],
    ])
    render(<ConsentRecordsPage />)
    expect(await screen.findByRole('list', { name: '내 동의 기록' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /전문 보기/ })).not.toBeInTheDocument()
  })

  it('기록을 못 받으면 안내하고 다시 불러온다', async () => {
    routeFetch([
      ['GET', '/users/me/consents', fail(500, 'COMMON_999')],
      ['GET', '/consent-documents', ok(DOCS)],
      ['GET', '/users/me/consents', ok(RECORDS)],
      ['GET', '/consent-documents', ok(DOCS)],
    ])
    render(<ConsentRecordsPage />)
    expect(await screen.findByText(RECORDS_LOAD_FAILED)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('list', { name: '내 동의 기록' })).toBeInTheDocument()
  })
})
