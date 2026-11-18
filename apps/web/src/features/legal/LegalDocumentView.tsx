import Link from 'next/link'
import { Fragment } from 'react'
import { cx } from '@/shared/ui'
import { getLegalDocument, legalPath, listLegalDocuments } from './documents'
import {
  PERSON_REFERENCE_EFFECTIVE_AT,
  PERSON_REFERENCE_VERSION,
} from './documents/personReference'
import { EFFECTIVE_AT_V2, koreanDate, LEGAL_DRAFT } from './facts'
import { LEGAL_SOURCES } from './sources'
import type { LegalBlock, LegalDocSlug, LegalDocument, LegalSection } from './types'

export const DRAFT_NOTICE =
  '법적 검토 전 초안입니다. 법무 검토를 마치기 전까지 내용이 바뀔 수 있습니다.'

/**
 * 아직 채우지 않은 값(`[연락처]`)과, 혹시 남은 `[확정 필요: …]`·`[추정…]` 표시를 찾는다. 안쪽에 대괄호를 쓰지 않는다.
 * `[인물]`처럼 본문에 원래 있는 대괄호는 칠하지 않는다.
 */
const MARKER = /(\[(?:확정 필요|추정)[^\]]*\]|\[연락처\])/

/** 본문 한 줄. 미확정·추정 표시는 형광펜처럼 칠해 바로 보이게 한다 */
export function LegalText({ text }: { text: string }) {
  const parts = text.split(MARKER)
  return (
    <>
      {parts.map((part, i) =>
        MARKER.test(part) ? (
          <mark
            key={i}
            data-legal-marker={part.startsWith('[추정') ? 'guess' : 'todo'}
            className={cx(
              'rounded-4 px-(--space-2)',
              part.startsWith('[추정')
                ? 'bg-bg-stone text-text-ink'
                : 'bg-brand-lavender text-text-ink',
            )}
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'p') {
    return (
      <p>
        <LegalText text={block.text} />
      </p>
    )
  }
  if (block.kind === 'list') {
    const ListTag = block.ordered ? 'ol' : 'ul'
    return (
      <ListTag
        className={cx(
          'flex flex-col gap-(--space-6) pl-(--space-20)',
          block.ordered ? 'list-decimal' : 'list-disc',
        )}
      >
        {block.items.map((item) => (
          <li key={item}>
            <LegalText text={item} />
          </li>
        ))}
      </ListTag>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{block.caption}</caption>
        <thead>
          <tr>
            {block.head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-line-default bg-bg-warm px-(--space-10) py-(--space-8) type-kr-body-12-medium-lh19p2 text-text-ink"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} className="align-top">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={i}
                    scope="row"
                    className="w-1/3 border-b border-line-default px-(--space-10) py-(--space-8) font-medium text-text-ink"
                  >
                    <LegalText text={cell} />
                  </th>
                ) : (
                  <td
                    key={i}
                    // 띄어쓰기 없는 긴 주소가 칸을 넓혀 다른 칸을 한 글자 폭으로 누르지 않게 어디서든 줄을 바꾼다
                    className="border-b border-line-default px-(--space-10) py-(--space-8) wrap-anywhere"
                  >
                    <LegalText text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ section, index }: { section: LegalSection; index: number }) {
  const headingId = `${section.id}-title`
  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="pf-legal-section"
      data-important={section.important || undefined}
    >
      <h2 id={headingId}>
        {/* 조항 번호: 제목 앞 큰 옅은 숫자(넓은 화면은 왼쪽으로 내어 단다) */}
        <span className="pf-legal-num">{String(index + 1).padStart(2, '0')}</span>
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </section>
  )
}

/**
 * 2026-11-03 시행 개정(S15P31B204-543, 시행일은 -547에서 11-05 → 11-03, facts.ts EFFECTIVE_AT_V2). 처리방침 "변경" 절이 약속한 대로 시행 전 화면에서 미리 알리고 새 문서로 잇는다.
 * 그날 처리방침은 v2가 아니라 v2에 Mattermost 알림을 더한 v3가 현재 버전이 된다.
 */
export const NOVEMBER_UPDATES: Partial<Record<LegalDocSlug, { version: string; summary: string }>> =
  {
    'privacy-policy': {
      version: '2026-11-v3',
      summary:
        '재미로 보는 AI 관상, 영상에서 뽑은 프레임 묶음, Mattermost 알림(선택)을 더한 새 처리방침이',
    },
    'face-data': {
      version: '2026-10-v2',
      summary: '재미로 보는 AI 관상과 영상에서 뽑은 프레임 묶음을 더한 새 동의서가',
    },
  }

/** 동의서·약관 전문 한 장(REQ-F-32 "항목별 전문 확인"). 서버에서 정적으로 그린다 */
export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  const others = listLegalDocuments().filter((d) => d.slug !== doc.slug)
  const amended =
    doc.version === PERSON_REFERENCE_VERSION
      ? undefined
      : getLegalDocument(doc.slug, PERSON_REFERENCE_VERSION)
  const november = NOVEMBER_UPDATES[doc.slug]
  const upcoming = november && doc.effectiveAt < EFFECTIVE_AT_V2 ? november : undefined
  return (
    // 문서 판짜기(2026-10-31): 목차 없이 가운데 한 단(본문 680px). 상자 대신 머리카락 선. 모양은 refine.css `.pf-legal*`
    <article className="pf-legal">
      <header className="pf-legal-head">
        {LEGAL_DRAFT ? (
          <p role="note" className="pf-legal-draft">
            {DRAFT_NOTICE}
          </p>
        ) : null}
        {upcoming ? (
          <aside aria-label={`${koreanDate(EFFECTIVE_AT_V2)} 개정 안내`} className="pf-legal-draft">
            {upcoming.summary} {koreanDate(EFFECTIVE_AT_V2)}부터 시행됩니다.{' '}
            <Link href={legalPath(doc.slug, upcoming.version)}>변경 내용 보기</Link>
          </aside>
        ) : null}
        {amended ? (
          <aside aria-label="인물·사진 참조 요청 처리 안내" className="pf-legal-draft">
            현재의 인물·사진 참조 요청 처리 방식을 설명한 새 문서가{' '}
            {koreanDate(PERSON_REFERENCE_EFFECTIVE_AT)}부터 시행됩니다.{' '}
            <Link href={legalPath(doc.slug, PERSON_REFERENCE_VERSION)}>변경 내용 보기</Link>
          </aside>
        ) : null}
        <h1>{doc.title}</h1>
        <dl className="pf-legal-meta">
          <div className="flex gap-(--space-4)">
            <dt>버전</dt>
            <dd>{doc.version}</dd>
          </div>
          <div className="flex gap-(--space-4)">
            <dt>시행일</dt>
            <dd>
              <time dateTime={doc.effectiveAt}>{koreanDate(doc.effectiveAt)}</time>
            </dd>
          </div>
        </dl>
        <p className="pf-legal-intro">
          <LegalText text={doc.intro} />
        </p>
      </header>

      <div className="pf-legal-body">
        {doc.sections.map((s, i) => (
          <Section key={s.id} section={s} index={i} />
        ))}

        <details className="pf-legal-basis">
          <summary>작성 근거 (검토용)</summary>
          <div className="mt-(--space-12) flex flex-col gap-(--space-12) type-kr-caption-11-regular-lh16p5">
            <Block
              block={{
                kind: 'table',
                caption: '조항별 작성 근거',
                head: ['조항', '근거'],
                rows: doc.sections.map((s) => [s.title, s.basis.join(' / ')]),
              }}
            />
            <p className="type-kr-body-12-medium-lh15p6 text-text-ink">공식 출처</p>
            <ul className="flex list-disc flex-col gap-(--space-4) pl-(--space-20)">
              {LEGAL_SOURCES.map((src) => (
                <li key={src.id}>
                  {src.name} — {src.org}, {src.edition}.{' '}
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    원문
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </details>

        <nav aria-label="다른 문서" className="pf-legal-others">
          <p>다른 문서</p>
          <ul>
            {others.map((d) => (
              <li key={`${d.slug}/${d.version}`}>
                <Link href={legalPath(d.slug, d.version)}>{d.title}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </article>
  )
}
