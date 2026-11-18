'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { getFaceModel, listFaceModels, listSimulations } from './api'
import type { FaceModelSummary, SimulationSummary } from './types'

/**
 * 회원 작업실 데이터. 진입할 때 한 번 부른다.
 * - API-HIS-01 내 모델 목록(최대 50 — 머리 선택 줄에 다 보인다)
 * - API-HIS-06 최근 기록(페이지 20, `더 보기`)
 *
 * 만드는 중·최근 실패한 3D(API-REC-03)는 작업실이 따로 묻지 않는다. 어느 화면에서나 하단 진행 팝업이
 * 진행과 실패를 같은 자리에 보여 준다(`reconstruction/ProgressDock`, 2026-11-01 사용자 결정).
 */

const RECORD_PAGE_SIZE = 20

export type LoadState = 'loading' | 'ready' | 'error'

export function useStudioHeads(faceModelId: string | null) {
  const [state, setState] = useState<LoadState>('loading')
  const [faceModels, setFaceModels] = useState<FaceModelSummary[]>([])
  const [missingId, setMissingId] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listFaceModels({ page: 0, size: 50 }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setFaceModels(page.items)
        setState('ready')
        setMissingId(null)
        // 작업실에 돌아오면 이전 목록이 남아 있다. 이번 요청의 목록과 상세 응답으로 확인한다.
        if (faceModelId && !page.items.some((model) => model.faceModelId === faceModelId)) {
          void getFaceModel(faceModelId, controller.signal).catch((error: unknown) => {
            if (!controller.signal.aborted && error instanceof ApiError && error.isNotFound) {
              setMissingId(faceModelId)
            }
          })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.warn('내 모델 목록을 불러오지 못했다', error)
        // 삭제 뒤 다시 받기(remove)는 이미 보이는 목록을 지키고, 처음·다시 불러오기만 오류 화면으로
        setState((prev) => (prev === 'ready' ? prev : 'error'))
      })
    return () => controller.abort()
  }, [attempt, faceModelId])

  const retry = useCallback(() => {
    setState('loading')
    setAttempt((n) => n + 1)
  }, [])

  /**
   * 3D 삭제 성공(또는 이미 없음) 뒤: 목록에서 바로 빼고, 뼈대 없이 서버 목록을 다시 받는다.
   * 다시 받기가 실패하면 뺀 목록을 그대로 둔다(오류 화면으로 바꾸지 않는다).
   */
  const remove = useCallback((faceModelId: string) => {
    setFaceModels((prev) => prev.filter((model) => model.faceModelId !== faceModelId))
    setAttempt((n) => n + 1)
  }, [])

  /** 이름 바꾸기 성공 뒤: 서버가 저장한 이름으로 목록만 고친다(다시 받지 않는다) */
  const rename = useCallback((faceModelId: string, title: string) => {
    setFaceModels((prev) =>
      prev.map((model) => (model.faceModelId === faceModelId ? { ...model, title } : model)),
    )
  }, [])

  /** 썸네일을 방금 저장했으면(-436) 다시 받지 않고 칸 그림만 바꾼다 */
  const setThumbnail = useCallback((faceModelId: string, thumbnailUrl: string) => {
    setFaceModels((prev) =>
      prev.map((model) => (model.faceModelId === faceModelId ? { ...model, thumbnailUrl } : model)),
    )
  }, [])

  return { state, faceModels, missingId, retry, remove, rename, setThumbnail }
}

export function useRecentRecords() {
  const [state, setState] = useState<LoadState>('loading')
  const [items, setItems] = useState<SimulationSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listSimulations({ page: 0, size: RECORD_PAGE_SIZE }, controller.signal)
      .then((result) => {
        setItems(result.items)
        setTotal(result.totalElements)
        setPage(0)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.warn('최근 기록을 불러오지 못했다', error)
        setState('error')
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setState('loading')
    setAttempt((n) => n + 1)
  }, [])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const next = await listSimulations({ page: page + 1, size: RECORD_PAGE_SIZE })
      setItems((prev) => {
        // 그사이 지운 기록 때문에 페이지 경계가 밀려 겹칠 수 있다
        const seen = new Set(prev.map((item) => item.simulationId))
        return [...prev, ...next.items.filter((item) => !seen.has(item.simulationId))]
      })
      setTotal(next.totalElements)
      setPage(page + 1)
    } finally {
      setLoadingMore(false)
    }
  }, [page])

  /** 삭제 성공(또는 이미 없음) 뒤 목록에서 뺀다 */
  const remove = useCallback((simulationId: string) => {
    setItems((prev) => prev.filter((item) => item.simulationId !== simulationId))
    setTotal((n) => Math.max(0, n - 1))
  }, [])

  // 시안 이름을 바꾼 뒤 목록의 그 카드만 고친다(2026-10-30)
  const rename = useCallback((simulationId: string, title: string) => {
    setItems((prev) =>
      prev.map((item) => (item.simulationId === simulationId ? { ...item, title } : item)),
    )
  }, [])

  return {
    state,
    items,
    total,
    hasMore: items.length < total,
    loadingMore,
    loadMore,
    remove,
    rename,
    retry,
  }
}
