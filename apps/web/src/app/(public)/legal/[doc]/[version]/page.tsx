import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLegalDocument, listLegalDocuments } from '@/features/legal/documents'
import { LegalDocumentView } from '@/features/legal/LegalDocumentView'

/**
 * 동의서·약관 전문(REQ-F-32 "항목별 전문 확인"). 경로는 BE 시드 content_url `/legal/{doc}/{version}`.
 * 가입 동의(SCR-02)·동의 기록(SCR-03)의 "보기"가 새 창으로 이 페이지를 연다.
 * 있는 문서·버전은 모두 빌드 때 정적으로 만든다. 없는 조합은 404.
 */
export function generateStaticParams() {
  return listLegalDocuments().map((d) => ({ doc: d.slug, version: d.version }))
}

export async function generateMetadata({
  params,
}: PageProps<'/legal/[doc]/[version]'>): Promise<Metadata> {
  const { doc, version } = await params
  const found = getLegalDocument(doc, version)
  return { title: found ? `${found.title} (${found.version})` : '문서를 찾을 수 없어요' }
}

export default async function LegalDocumentPage({ params }: PageProps<'/legal/[doc]/[version]'>) {
  const { doc, version } = await params
  const found = getLegalDocument(doc, version)
  if (!found) notFound()
  return <LegalDocumentView doc={found} />
}
