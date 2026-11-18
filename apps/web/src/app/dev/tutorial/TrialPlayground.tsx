'use client'

import { useEffect, useState } from 'react'
import { BaseModelTrial } from '@/features/tutorial/BaseModelTrial'
import { clearTutorialRecord } from '@/features/tutorial/storage'
import { BASE_MODEL_MESH_URL } from '@/features/viewer/assets'
import { Button } from '@/shared/ui'

/** 합성 머리를 브라우저에서 GLB로 내보내 blob 주소로 만든다(/dev/viewer와 같은 방식) */
async function createSyntheticGlbUrl(): Promise<string> {
  const [{ createSyntheticHead }, { GLTFExporter }] = await Promise.all([
    import('@/features/viewer/syntheticHead'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ])
  const glb = await new GLTFExporter().parseAsync(createSyntheticHead(), { binary: true })
  return URL.createObjectURL(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }))
}

/**
 * - 기본: 합성 머리. 기본 모델 GLB가 저장소에 아직 없어서다
 * - `?src=base`: 실제 기본 모델 경로(지금은 404 → 뷰어 오류 상태에서도 튜토리얼이 도는지 본다)
 * - `?reset=1`: 들어올 때 튜토리얼 기록을 지운다(처음 방문 흉내, 스크린샷용)
 * - `?step=2`: 스크린샷용. 튜토리얼을 n단계(1부터)까지 넘겨 둔다
 */
export function TrialPlayground() {
  const [meshUrl, setMeshUrl] = useState('')
  const [round, setRound] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('reset') === '1') clearTutorialRecord()
    let url = ''
    let canceled = false
    const ready =
      params.get('src') === 'base'
        ? Promise.resolve(BASE_MODEL_MESH_URL)
        : createSyntheticGlbUrl().then((created) => (url = created))
    ready.then((next) => {
      if (canceled) return
      setMeshUrl(next)
      const step = Number(params.get('step') ?? 1)
      // 스크린샷용: "다음"을 step-1번 누른다. 한 번 누를 때마다 다시 그려지도록 사이를 둔다
      for (let i = 1; i < step; i += 1) {
        window.setTimeout(() => {
          document.querySelector<HTMLButtonElement>('[data-coachmark="next"]')?.click()
        }, 300 * i)
      }
    })
    return () => {
      canceled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [])

  function restart() {
    clearTutorialRecord()
    setRound((prev) => prev + 1)
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-(--space-20) px-(--space-20) py-(--space-24) md:px-(--space-40)">
      <div className="flex flex-wrap items-center justify-between gap-(--space-12)">
        <h1 className="type-kr-heading-15-medium-ls-0p5-lh19p5 text-text-ink">
          기본 모델 체험 튜토리얼 (개발용)
        </h1>
        <Button variant="text" layout="wrapped" trailingIcon={null} onClick={restart}>
          기록 지우고 처음부터
        </Button>
      </div>
      <div className="w-full md:max-w-187">
        {meshUrl ? <BaseModelTrial key={round} meshUrl={meshUrl} /> : null}
      </div>
    </main>
  )
}
