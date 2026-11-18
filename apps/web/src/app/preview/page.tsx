import { Suspense } from 'react'
import { PreviewStudio } from './preview-studio'
import './preview.css'

export const metadata = { title: 'Preface — 새로운 시선' }

export default function PreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="preface-preview pp-page-loading" role="status">
          스튜디오를 준비하고 있어요.
        </div>
      }
    >
      <PreviewStudio />
    </Suspense>
  )
}
