import { Suspense } from 'react'
import { PreviewStudio } from '../preview-studio'
import '../preview.css'
import '../flow.css'

export const metadata = { title: '편집실 · Preface 미리보기' }
export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="preface-preview pp-page-loading" role="status">
          편집실을 준비하고 있어요.
        </div>
      }
    >
      <PreviewStudio mode="editor" />
    </Suspense>
  )
}
