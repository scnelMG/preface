'use client'
import { useEffect, useState } from 'react'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import type { WorkspaceModel } from './workspace-data'
export interface LocalModel {
  id: string
  title: string
  date: string
  meshUrl: string
}
export function useLocalModels(enabled = true) {
  const [models, setModels] = useState<LocalModel[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch('/api/preview/local-models', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((data) => {
        setModels(data.models ?? [])
        setLoaded(true)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true)
      })
    return () => controller.abort()
  }, [enabled])
  return { models, loaded }
}
export function workspaceLocalModel(model: LocalModel): WorkspaceModel {
  return {
    id: model.id,
    title: model.title,
    date: model.date.replaceAll('-', '.'),
    sample: {
      ...SAMPLE_HEADS[1],
      title: model.title,
      shortTitle: model.title,
      meshUrl: model.meshUrl,
    },
    pose: 0,
    weights: {},
    drafts: [],
    href:
      '/preview/editor?member=1&source=workspace&local=' +
      model.id +
      '&name=' +
      encodeURIComponent(model.title),
    local: true,
  }
}
