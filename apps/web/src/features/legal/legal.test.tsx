import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LegalDocumentPage, { generateStaticParams } from '@/app/(public)/legal/[doc]/[version]/page'
import { Footer } from '@/shared/ui/Footer'
import {
  getLegalDocument,
  latestLegalPath,
  legalFooterLinks,
  listLegalDocuments,
} from './documents'
import {
  PERSON_REFERENCE_EFFECTIVE_AT,
  PERSON_REFERENCE_VERSION,
} from './documents/personReference'
import { CONSENT_EXIT, CONTACT, EFFECTIVE_AT, EFFECTIVE_AT_V2, koreanDate } from './facts'
import { DRAFT_NOTICE, LegalDocumentView, LegalText } from './LegalDocumentView'

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
)
vi.mock('next/navigation', () => ({ notFound }))

/** BE 시드가 가입 화면에 내려주는 content_url. 여기 있는 경로는 모두 페이지가 있어야 한다 */
function seededContentUrls(): string[] {
  // vitest는 apps/web에서 돈다(CI web:test도 같다)
  const seed = readFileSync(
    resolve(
      process.cwd(),
      '../../services/backend/common/src/main/resources/db/migration/V2__seed_consent_documents.sql',
    ),
    'utf8',
  )
  return [...seed.matchAll(/'(\/legal\/[^']+)'/g)].map((m) => m[1])
}

async function renderPage(doc: string, version: string) {
  const ui = await LegalDocumentPage({
    params: Promise.resolve({ doc, version }),
    searchParams: Promise.resolve({}),
  })
  return render(ui)
}

function headings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
}

describe('2026-10-v2 — AI 관상 (S15P31B204-439)', () => {
  it('얼굴 데이터 동의서 v2는 관상 사진 전송·결과 보관과 20~60초(-538)를 담고, v1 본문은 그대로다', () => {
    const v2 = getLegalDocument('face-data', '2026-10-v2')!
    expect(v2.effectiveAt).toBe(EFFECTIVE_AT_V2)
    const { unmount } = render(<LegalDocumentView doc={v2} />)
    expect(screen.getByText(/20~60초, 원본 그대로/)).toBeInTheDocument()
    expect(screen.getAllByText(/정면 사진 1장/).length).toBeGreaterThan(0)
    expect(screen.getByText('AI 관상 결과(글)')).toBeInTheDocument()
    unmount()

    render(<LegalDocumentView doc={getLegalDocument('face-data', '2026-10-v1')!} />)
    expect(screen.getByText(/25~45초, 원본 그대로/)).toBeInTheDocument()
    // 본문에는 없다. 위쪽 11-03 개정 안내(aside)에만 나온다(-543)
    expect(screen.queryByText(/AI 관상/, { ignore: 'aside, aside *' })).not.toBeInTheDocument()
  })

  it('처리방침 v2는 관상을 위탁·생성형 AI 절과 이전 버전 안내에 담는다', () => {
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v2')!} />)
    expect(screen.getByText(/재미로 보는 AI 관상 풀이 생성/)).toBeInTheDocument()
    expect(screen.getByText(/이전 버전: 2026-10-v1/)).toBeInTheDocument()
    // 다른 이슈(-447)가 v1 표에 더한 이용 분석 행은 v2에도 남는다
    expect(screen.getByText('서비스 이용 통계 분석(Google Analytics)')).toBeInTheDocument()
    expect(screen.getByText('이용 분석 정보')).toBeInTheDocument()
    expect(screen.getByText('AI 관상 결과(글)')).toBeInTheDocument()
    expect(
      screen.getByText(`이 처리방침은 ${koreanDate(EFFECTIVE_AT_V2)}부터 적용합니다.`),
    ).toBeInTheDocument()
  })

  it('v2는 영상에서 뽑은 프레임 묶음을 수집 항목·보관 기간에 담고, v1 본문은 그대로다 (S15P31B204-522)', () => {
    const { unmount } = render(
      <LegalDocumentView doc={getLegalDocument('face-data', '2026-10-v2')!} />,
    )
    expect(screen.getByText(/영상에서 뽑은 프레임 묶음\(3D를 만드는 데만/)).toBeInTheDocument()
    expect(
      screen.getByText('촬영한 얼굴 영상(원본)과 영상에서 뽑은 프레임 묶음'),
    ).toBeInTheDocument()
    unmount()

    const policy = render(
      <LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v2')!} />,
    )
    expect(
      screen.getByText(/영상에서 뽑은 프레임 묶음\(3D 생성 후 삭제\), 얼굴 사진 5방향/),
    ).toBeInTheDocument()
    expect(
      screen.getByText('촬영한 얼굴 영상(원본)과 영상에서 뽑은 프레임 묶음'),
    ).toBeInTheDocument()
    expect(screen.queryByText('촬영한 얼굴 영상(원본)')).not.toBeInTheDocument()
    policy.unmount()

    for (const slug of ['face-data', 'privacy-policy'] as const) {
      expect(JSON.stringify(getLegalDocument(slug, '2026-10-v1'))).not.toContain('프레임 묶음')
    }
  })

  it('현재 버전 링크는 시행일이 지나야 바뀐다(처리방침은 같은 날 시행하는 v3, -543)', () => {
    expect(latestLegalPath('privacy-policy', '2026-11-02')).toBe('/legal/privacy-policy/2026-10-v1')
    expect(latestLegalPath('privacy-policy', EFFECTIVE_AT_V2)).toBe(
      '/legal/privacy-policy/2026-11-v3',
    )
    expect(latestLegalPath('face-data', '2026-11-02')).toBe('/legal/face-data/2026-10-v1')
    expect(latestLegalPath('terms', '2026-12-01')).toBe('/legal/terms/2026-10-v1')
  })
})

describe('2026-12-v1 — 인물·사진 참조 요청 안내 (S15P31B204-98)', () => {
  it('새 약관·개인정보 문서와 처리방침만 현재 처리 문구를 담고, 이전 버전은 보존한다', () => {
    for (const slug of ['terms', 'privacy', 'privacy-policy'] as const) {
      const doc = getLegalDocument(slug, PERSON_REFERENCE_VERSION)!
      expect(doc.effectiveAt).toBe(PERSON_REFERENCE_EFFECTIVE_AT)
      const { unmount } = render(<LegalDocumentView doc={doc} />)
      expect(screen.getAllByText(/\[인물·사진 참조 요청\]/).length).toBeGreaterThan(0)
      unmount()
    }
    expect(JSON.stringify(getLegalDocument('terms', '2026-10-v1'))).not.toContain(
      '[인물·사진 참조 요청]',
    )
    expect(JSON.stringify(getLegalDocument('privacy-policy', '2026-10-v2'))).not.toContain(
      '[인물·사진 참조 요청]',
    )
  })

  it('시행 전 기존 전문에 변경 내용과 새 버전 링크를 보여 준다', () => {
    render(<LegalDocumentView doc={getLegalDocument('terms', '2026-10-v1')!} />)
    const notice = screen.getByRole('complementary', { name: '인물·사진 참조 요청 처리 안내' })
    expect(notice).toHaveTextContent('2026년 12월 15일')
    expect(within(notice).getByRole('link', { name: '변경 내용 보기' })).toHaveAttribute(
      'href',
      '/legal/terms/2026-12-v1',
    )
    expect(latestLegalPath('terms', '2026-12-14')).toBe('/legal/terms/2026-10-v1')
    expect(latestLegalPath('terms', PERSON_REFERENCE_EFFECTIVE_AT)).toBe('/legal/terms/2026-12-v1')
  })

  it('처리방침 2026-11-v4·얼굴 동의서 2026-11-v3(11-11)은 정면 사진 1장 본인 편집실 표시 목적만 더한다 (S15P31B204-770)', () => {
    const v4 = getLegalDocument('privacy-policy', '2026-11-v4')!
    const v3 = getLegalDocument('privacy-policy', '2026-11-v3')!
    expect(v4.effectiveAt).toBe('2026-11-11')
    const purpose = (doc: typeof v4) => {
      const block = doc.sections.find((section) => section.id === 'purpose')!.blocks[0]
      return block.kind === 'list' ? block.items : []
    }
    const at = purpose(v4).findIndex((item) => item.includes('(얼굴 사진 5방향)'))
    expect(purpose(v4)[at + 1]).toBe(
      '본인이 편집실에서 3D 얼굴과 실제 얼굴을 비교하거나 AI 관상 결과와 함께 볼 수 있도록, 얼굴 사진 5방향 중 정면 사진 1장을 본인 화면에 표시(본인 계정에서만, 새로 모으는 정보 없음)',
    )
    expect(purpose(v4)).toHaveLength(purpose(v3).length + 1)
    const changes = v4.sections.find((section) => section.id === 'changes')!.blocks[0]
    expect(changes.kind === 'list' && changes.items).toEqual(
      expect.arrayContaining([
        '이 처리방침은 2026년 11월 11일부터 적용합니다.',
        '이전 버전: 2026-11-v3 — 바뀐 점: 얼굴 사진 5방향 중 정면 사진 1장을 본인 편집실 비교 화면과 AI 관상 결과 화면에 표시하는 목적을 더함. 새로 수집하는 항목과 보유 기간은 바뀌지 않음.',
      ]),
    )
    // 목적·변경 절 밖은 v3 그대로다
    for (const section of v4.sections.filter((s) => !['purpose', 'changes'].includes(s.id))) {
      expect(section).toEqual(v3.sections.find((s) => s.id === section.id))
    }
    expect(JSON.stringify(v3)).not.toContain('본인 편집실')

    const face = getLegalDocument('face-data', '2026-11-v3')!
    const face2 = getLegalDocument('face-data', '2026-10-v2')!
    expect(face.effectiveAt).toBe('2026-11-11')
    const facePurpose = face.sections.find((section) => section.id === 'purpose')!
    const items = facePurpose.blocks[0].kind === 'list' ? facePurpose.blocks[0].items : []
    expect(items[2]).toBe(
      '얼굴 사진 5장은 3D 얼굴의 품질을 확인하고 이용자 피드백을 분석해 서비스를 개선하는 데 씁니다. 그중 정면 사진 1장은 본인이 편집실에서 3D와 비교하거나 AI 관상 결과와 함께 볼 수 있도록 본인 화면에만 보여 드립니다. 다른 사람에게 보이지 않고, AI(LLM)로 보내지 않습니다.',
    )
    // 얼굴 인식·목적 외 이용 금지 문단은 그대로
    expect(facePurpose.blocks[1]).toEqual(
      face2.sections.find((section) => section.id === 'purpose')!.blocks[1],
    )
    for (const section of face.sections.filter((s) => s.id !== 'purpose')) {
      expect(section).toEqual(face2.sections.find((s) => s.id === section.id))
    }
    expect(latestLegalPath('face-data', '2026-11-11')).toBe('/legal/face-data/2026-11-v3')
    expect(latestLegalPath('face-data', '2026-11-10')).toBe('/legal/face-data/2026-10-v2')
    expect(latestLegalPath('privacy-policy', '2026-11-10')).toBe('/legal/privacy-policy/2026-11-v3')
  })

  it('처리방침 2026-12-v1(12-15)은 v4를 이어 받아 정면 사진 목적을 지키고, 이전 버전을 2026-11-v4로 적는다 (S15P31B204-770)', () => {
    const v12 = getLegalDocument('privacy-policy', PERSON_REFERENCE_VERSION)!
    const list = (id: string) => {
      const block = v12.sections.find((section) => section.id === id)!.blocks[0]
      return block.kind === 'list' ? block.items : []
    }
    expect(list('purpose')).toContain(
      '본인이 편집실에서 3D 얼굴과 실제 얼굴을 비교하거나 AI 관상 결과와 함께 볼 수 있도록, 얼굴 사진 5방향 중 정면 사진 1장을 본인 화면에 표시(본인 계정에서만, 새로 모으는 정보 없음)',
    )
    const history = list('changes').find((item) => item.startsWith('이전 버전:'))!
    expect(history.startsWith('이전 버전: 2026-11-v4(2026년 11월 11일 시행) — 바뀐 점:')).toBe(true)
    expect(history).toContain('인물·사진 참조 요청의 거절')
    expect(history).toContain('정면 사진 1장')
    expect(history).not.toContain('2026-11-v3')
    expect(list('changes')).toContain(
      `이 처리방침은 ${koreanDate(PERSON_REFERENCE_EFFECTIVE_AT)}부터 적용합니다.`,
    )
    // 12-v1 자기 변경(인물·사진 참조)은 그대로
    expect(JSON.stringify(v12)).toContain(
      '인물·사진 참조로 판정한 요청은 SSAFY GMS에 보내지 않습니다.',
    )
    expect(latestLegalPath('privacy-policy', '2026-12-14')).toBe('/legal/privacy-policy/2026-11-v4')
    expect(latestLegalPath('privacy-policy', PERSON_REFERENCE_EFFECTIVE_AT)).toBe(
      `/legal/privacy-policy/${PERSON_REFERENCE_VERSION}`,
    )
  })

  it('BE V33 시드가 얼굴 동의서 2026-11-v3을 11-11 00:00 KST에 시행한다 (S15P31B204-770)', () => {
    const seed = readFileSync(
      resolve(
        process.cwd(),
        '../../services/backend/common/src/main/resources/db/migration/V33__face_data_consent_v3.sql',
      ),
      'utf8',
    )
    expect(seed).toContain("'FACE_DATA', '2026-11-v3'")
    expect(seed).toContain("'/legal/face-data/2026-11-v3'")
    expect(seed).toContain("'2026-11-10 15:00:00'")
    expect(getLegalDocument('face-data', '2026-11-v3')).toBeDefined()
  })

  it('처리방침 2026-11-v3(11-03)은 v2에 Mattermost 알림을 목적·항목·보유 기간·위탁으로 더하고, 12-v1이 이어받는다 (S15P31B204-543)', () => {
    const v3 = getLegalDocument('privacy-policy', '2026-11-v3')!
    expect(v3.effectiveAt).toBe(EFFECTIVE_AT_V2)
    const { unmount } = render(<LegalDocumentView doc={v3} />)
    expect(
      screen.getByText(
        '3D 생성 진행·결과 알림(서비스 안 알림, 이용자가 원하면 SSAFY Mattermost DM)',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Mattermost 아이디와 알림 연결 시각\(Mattermost 알림을 켠 경우\)/),
    ).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Mattermost 아이디·알림 연결 시각/ })).toHaveTextContent(
      '알림을 끄거나 탈퇴하면 바로 삭제합니다',
    )
    expect(screen.getByRole('row', { name: /^SSAFY 서비스 서버/ })).toHaveTextContent(
      'SSAFY Mattermost로 아이디·알림 문구 전달',
    )
    // v2의 관상·프레임 묶음 변경은 그대로 담는다
    expect(screen.getAllByText(/AI 관상/).length).toBeGreaterThan(0)
    unmount()
    const v12 = JSON.stringify(getLegalDocument('privacy-policy', PERSON_REFERENCE_VERSION))
    expect(v12).toContain('SSAFY Mattermost로 아이디·알림 문구 전달')
    expect(v12.match(/Mattermost 아이디·알림 연결 시각/g)).toHaveLength(1)
    expect(JSON.stringify(getLegalDocument('privacy-policy', '2026-10-v2'))).not.toContain(
      'Mattermost',
    )
  })

  it('11-03 시행 전 처리방침·얼굴 동의서 v1에 개정 안내와 새 문서 링크를 보여 준다 (S15P31B204-543)', () => {
    const { unmount } = render(
      <LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v1')!} />,
    )
    const policy = screen.getByRole('complementary', { name: '2026년 11월 3일 개정 안내' })
    expect(policy).toHaveTextContent('Mattermost 알림(선택)')
    expect(policy).toHaveTextContent('2026년 11월 3일부터 시행됩니다')
    expect(within(policy).getByRole('link', { name: '변경 내용 보기' })).toHaveAttribute(
      'href',
      '/legal/privacy-policy/2026-11-v3',
    )
    unmount()

    const { unmount: unmountFace } = render(
      <LegalDocumentView doc={getLegalDocument('face-data', '2026-10-v1')!} />,
    )
    expect(
      within(screen.getByRole('complementary', { name: '2026년 11월 3일 개정 안내' })).getByRole(
        'link',
        { name: '변경 내용 보기' },
      ),
    ).toHaveAttribute('href', '/legal/face-data/2026-10-v2')
    unmountFace()

    // 시행된 문서(v3)와 개정이 없는 약관에는 띄우지 않는다
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-11-v3')!} />)
    expect(
      screen.queryByRole('complementary', { name: '2026년 11월 3일 개정 안내' }),
    ).not.toBeInTheDocument()
  })

  it('BE의 새 필수 동의서 경로와 시행 시각이 FE 문서와 맞는다', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        '../../services/backend/common/src/main/resources/db/migration/V17__person_reference_consent_v2.sql',
      ),
      'utf8',
    )
    for (const slug of ['terms', 'privacy'] as const) {
      expect(migration).toContain(`/legal/${slug}/${PERSON_REFERENCE_VERSION}`)
    }
    expect(migration).toContain("1, '2026-12-14 15:00:00'")
  })
})

describe('동의서 전문 페이지', () => {
  it('BE 시드의 동의서 4종 경로가 모두 열린다', async () => {
    const urls = seededContentUrls()
    expect(urls).toHaveLength(4)
    for (const url of urls) {
      const [, , doc, version] = url.split('/')
      const { unmount } = await renderPage(doc, version)
      const found = getLegalDocument(doc, version)
      expect(found).toBeDefined()
      expect(screen.getByRole('heading', { level: 1, name: found!.title })).toBeInTheDocument()
      expect(screen.getByRole('note')).toHaveTextContent(DRAFT_NOTICE)
      expect(screen.getByText(found!.version)).toBeInTheDocument()
      unmount()
    }
  })

  it('목차 없이 조항이 차례로 이어진다(2026-10-31 단순화)', async () => {
    await renderPage('terms', '2026-10-v1')
    expect(screen.queryByRole('navigation', { name: '목차' })).not.toBeInTheDocument()
    const doc = getLegalDocument('terms', '2026-10-v1')!
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(
      doc.sections.length,
    )
  })

  it.each([
    ['nope', '2026-10-v1'],
    ['terms', '2099-01-v9'],
    ['toString', 'constructor'],
  ])('없는 문서·버전(%s/%s)은 404', async (doc, version) => {
    notFound.mockClear()
    await expect(renderPage(doc, version)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  it('2026-10-v1 문서의 시행일은 BE 동의서 시행일과 같은 2026-10-26이다', () => {
    // BE는 S15P31B204-354(MR !86)의 새 migration으로 4종 effective_at을 2026-10-26 00:00 KST로 맞춘다
    expect(EFFECTIVE_AT).toBe('2026-10-26')
    for (const d of listLegalDocuments().filter((doc) => doc.version === '2026-10-v1')) {
      expect(d.effectiveAt).toBe(EFFECTIVE_AT)
      const { unmount } = render(<LegalDocumentView doc={d} />)
      expect(screen.getByText('2026년 10월 26일')).toBeInTheDocument()
      unmount()
    }
  })

  it('정적 경로는 등록된 문서·버전과 같다', () => {
    expect(generateStaticParams()).toEqual(
      listLegalDocuments().map((d) => ({ doc: d.slug, version: d.version })),
    )
  })
})

describe('필수 조항', () => {
  // 개인정보 보호법 제15조제2항: 목적·항목·보유 기간·거부 권리와 불이익
  it.each([
    ['privacy', ['수집하는 항목과 목적', '보유·이용 기간', '동의를 거부할 권리']],
    ['face-data', ['수집하는 얼굴 데이터', '이용 목적', '보관 기간과 삭제', '동의를 거부할 권리']],
    ['face-public', ['공개 대상과 범위', '동의를 거부할 권리']],
  ])('%s 동의서에 제15조제2항 항목이 있다', (slug, titles) => {
    render(<LegalDocumentView doc={getLegalDocument(slug, '2026-10-v1')!} />)
    const hs = headings()
    for (const t of titles) expect(hs.some((h) => h.includes(t))).toBe(true)
  })

  it('처리방침에 법 제30조·시행령 제31조 기재 사항이 있다', () => {
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v1')!} />)
    const hs = headings()
    for (const t of [
      '개인정보의 처리 목적',
      '처리하는 개인정보의 항목',
      '개인정보의 처리 및 보유 기간',
      '개인정보의 파기 절차 및 방법',
      '개인정보의 제3자 제공',
      '개인정보 처리업무의 위탁',
      '개인정보의 국외 이전',
      '개인정보의 안전성 확보조치',
      '민감정보의 공개 가능성 및 비공개 선택 방법',
      '정보주체와 법정대리인의 권리·의무 및 행사방법',
      '개인정보 보호책임자 및 고충 처리 부서',
      '개인정보 자동 수집 장치의 설치·운영 및 거부',
      '개인정보 처리방침의 변경',
    ]) {
      expect(hs.some((h) => h.includes(t))).toBe(true)
    }
  })

  it('이용약관 첫 조항은 참고용 시뮬레이션·의료행위 아님 고지다', () => {
    render(<LegalDocumentView doc={getLegalDocument('terms', '2026-10-v1')!} />)
    const first = screen.getAllByRole('region')[0]
    expect(first).toHaveTextContent('참고용 시뮬레이션')
    expect(first).toHaveTextContent('의료행위가 아닙니다')
  })

  it('1차 편집 부위는 코, 눈·윤곽은 예정으로 적는다', () => {
    for (const slug of ['terms', 'face-data'] as const) {
      const { unmount } = render(<LegalDocumentView doc={getLegalDocument(slug, '2026-10-v1')!} />)
      expect(
        screen.getByText(/현재 편집할 수 있는 부위는 코이며, 눈·윤곽 편집은 이후 제공할 예정/),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('미확정 표시가 남지 않고, 연락처는 팀 메일이다', () => {
    const texts: string[] = []
    for (const d of listLegalDocuments()) {
      texts.push(d.title, d.intro)
      for (const s of d.sections) {
        texts.push(s.title, ...s.basis)
        for (const b of s.blocks) {
          if (b.kind === 'p') texts.push(b.text)
          else if (b.kind === 'list') texts.push(...b.items)
          else texts.push(b.caption, ...b.head, ...b.rows.flat())
        }
      }
    }
    const all = texts.join('\n')
    expect(all).not.toMatch(/\[(확정 필요|추정)/)
    const brackets = new Set(all.match(/\[[^\]]*\]/g))
    expect([...brackets].sort()).toEqual(['[인물]', '[인물·사진 참조 요청]'].sort())
    expect(CONTACT).toBe('contact@example.com')
    expect(all).toContain('contact@example.com')
  })

  it('국외 이전은 이용 분석 정보(Google·Microsoft, 미국)뿐이고 저장 데이터는 국내, GMS는 처리위탁이다', () => {
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v1')!} />)
    const overseas = screen.getByRole('region', { name: /개인정보의 국외 이전/ })
    expect(overseas).not.toHaveTextContent('해당 없음')
    for (const name of ['Google LLC', 'Microsoft Corporation']) {
      expect(within(overseas).getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(
      within(overseas).getByRole('rowheader', { name: '이전 국가' }).closest('tr'),
    ).toHaveTextContent('미국미국')
    expect(overseas).toHaveTextContent('서울')
    expect(overseas).toHaveTextContent('서비스 이용에는 지장이 없습니다')
    const entrust = screen.getByRole('region', { name: /개인정보 처리업무의 위탁/ })
    expect(within(entrust).getByRole('rowheader', { name: 'SSAFY GMS' })).toBeInTheDocument()
    expect(entrust).toHaveTextContent('AI 상담 답변 생성')
    expect(within(entrust).getByRole('rowheader', { name: 'Google LLC' })).toBeInTheDocument()
    expect(
      within(entrust).getByRole('rowheader', { name: 'Microsoft Corporation' }),
    ).toBeInTheDocument()
  })

  it('분석 쿠키는 광고에 쓰지 않고, 녹화에서 얼굴 화면을 가리며, 거부해도 서비스는 그대로다', () => {
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v1')!} />)
    const auto = screen.getByRole('region', { name: /개인정보 자동 수집 장치/ })
    expect(auto).not.toHaveTextContent('광고·행태 분석용 쿠키는 쓰지 않습니다')
    expect(auto).toHaveTextContent('Google Analytics')
    expect(auto).toHaveTextContent('Microsoft Clarity')
    expect(auto).toHaveTextContent('광고 목적으로는 쓰지 않으며')
    expect(auto).toHaveTextContent('얼굴이 나오는 화면')
    expect(auto).toHaveTextContent('분석 쿠키를 막아도 서비스 이용에는 지장이 없습니다')
  })

  it('개별 동의 철회 안내는 없고, 동의를 거두려면 탈퇴하라고 안내한다', () => {
    for (const d of listLegalDocuments()) {
      const { container, unmount } = render(<LegalDocumentView doc={d} />)
      const text = container.textContent ?? ''
      expect(text, d.slug).not.toMatch(/철회하면|철회할 수 있|동의 철회·탈퇴|철회·탈퇴/)
      expect(text, d.slug).toContain(CONSENT_EXIT)
      expect(text, d.slug).toContain('탈퇴하면 유예 기간 없이')
      unmount()
    }
  })

  it('접속 로그 3개월 보관은 없고, 백업은 서울 리전에 7일이다', () => {
    for (const d of listLegalDocuments()) {
      const { container, unmount } = render(<LegalDocumentView doc={d} />)
      const text = container.textContent ?? ''
      expect(text, d.slug).not.toMatch(/(?<!\d)3개월|접속 기록\(접속 IP|통신비밀보호법/)
      unmount()
    }
    render(<LegalDocumentView doc={getLegalDocument('privacy-policy', '2026-10-v1')!} />)
    const retention = screen.getByRole('region', { name: /개인정보의 처리 및 보유 기간/ })
    const backup = within(retention).getByRole('rowheader', { name: '데이터베이스 백업' })
    expect(backup.closest('tr')).toHaveTextContent(/서울 리전.*7일/)
    expect(
      within(retention).getByRole('rowheader', { name: '서버 운영 로그' }).closest('tr'),
    ).toHaveTextContent('접속 기록을 따로 남기지 않습니다')
    expect(screen.getByRole('region', { name: /개인정보의 국외 이전/ })).toHaveTextContent(
      'SSAFY가 제공하는 국내 서버',
    )
  })

  it('조항마다 작성 근거가 있다', () => {
    for (const d of listLegalDocuments()) {
      for (const s of d.sections) expect(s.basis.length, `${d.slug}#${s.id}`).toBeGreaterThan(0)
    }
  })
})

describe('푸터 법적 문서 링크', () => {
  it('이용약관·개인정보 처리방침 최신 버전으로 가고(처리방침은 11-11 시행 v4), 처리방침은 굵게 보인다', () => {
    render(<Footer links={legalFooterLinks()} />)
    const terms = screen.getByRole('link', { name: '이용약관' })
    const policy = screen.getByRole('link', { name: '개인정보 처리방침' })
    expect(terms).toHaveAttribute('href', latestLegalPath('terms'))
    expect(policy).toHaveAttribute('href', latestLegalPath('privacy-policy'))
    expect(terms).toHaveAttribute('href', '/legal/terms/2026-10-v1')
    expect(policy).toHaveAttribute('href', '/legal/privacy-policy/2026-11-v4')
    expect(policy).toHaveClass('font-semibold')
    expect(terms).not.toHaveClass('font-semibold')
    expect(getLegalDocument('privacy-policy', '2026-10-v1')).toBeDefined()
  })

  it('문의 메일 주소를 주면 메일 링크로 보인다', () => {
    render(<Footer links={legalFooterLinks()} contact={CONTACT} />)
    expect(screen.getByRole('link', { name: `문의 ${CONTACT}` })).toHaveAttribute(
      'href',
      'mailto:contact@example.com',
    )
  })

  it('links를 주지 않으면 기존 푸터 그대로다', () => {
    render(<Footer />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('데이터 안내')).toBeInTheDocument()
  })
})

describe('LegalText', () => {
  it('확정 필요·추정 표시를 칠한다', () => {
    const { container } = render(
      <p>
        <LegalText text="문의 [연락처] / [확정 필요: 전화번호] / [추정: 경로] / [인물] 끝" />
      </p>,
    )
    const marks = container.querySelectorAll('mark')
    expect([...marks].map((m) => m.dataset.legalMarker)).toEqual(['todo', 'todo', 'guess'])
    expect(container).toHaveTextContent(
      '문의 [연락처] / [확정 필요: 전화번호] / [추정: 경로] / [인물] 끝',
    )
  })
})
