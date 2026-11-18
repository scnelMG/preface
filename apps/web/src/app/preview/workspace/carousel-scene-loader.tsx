'use client'

import dynamic from 'next/dynamic'
import { Component, type ReactNode } from 'react'
import type { WorkspaceModel } from './workspace-data'

const Thumbnail = dynamic(() => import('./workspace-scene').then((module) => module.DraftScene), {
  ssr: false,
})

export function DraftThumbnail({ model }: { model: WorkspaceModel }) {
  return (
    <SceneBoundary>
      <Thumbnail model={model} />
    </SceneBoundary>
  )
}

const Scene = dynamic(() => import('./workspace-scene'), {
  ssr: false,
  loading: () => <div className="pw-scene-loading">모델을 불러오고 있어요.</div>,
})

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p className="pw-scene-loading">
        3D 미리보기를 불러오지 못했어요. 아래 미리보기를 눌러 선택하세요.
      </p>
    ) : (
      this.props.children
    )
  }
}

export function CarouselScene(props: {
  models?: readonly WorkspaceModel[]
  hideCenter?: boolean
  turn: number
  animate: boolean
  onSelect?: (index: number) => void
}) {
  return (
    <SceneBoundary>
      <Scene {...props} />
    </SceneBoundary>
  )
}
