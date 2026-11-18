import { Suspense } from 'react'
import { WorkspacePreview } from './workspace-preview'
import '../preview.css'
import './workspace.css'

export const metadata = { title: '내 작업실 · 미리보기' }

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="preface-preview pp-page-loading" role="status">
          작업실을 불러오고 있어요.
        </div>
      }
    >
      <WorkspacePreview />
    </Suspense>
  )
}
