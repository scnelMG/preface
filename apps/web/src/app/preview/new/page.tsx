import { Suspense } from 'react'
import { NewModelPreview } from './new-model-preview'
import '../preview.css'
import '../flow.css'

export const metadata = { title: '휴대폰 연결 · Preface 미리보기' }
export default function NewModelPage() {
  return (
    <Suspense
      fallback={
        <div className="preface-preview pp-page-loading" role="status">
          화면을 준비하고 있어요.
        </div>
      }
    >
      <NewModelPreview />
    </Suspense>
  )
}
