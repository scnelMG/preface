'use client'
import { useCallback, useState } from 'react'
import { toastOnce } from '../lab/toastOnce'
import { HAIR_NONE, hairUrlOf } from './catalog'

/**
 * 실험실 헤어 선택 상태(S15P31B204-699). 화면 안에서만 들고 있고 서버·되돌리기 이력에는 남기지 않는다
 * (FN-HAIR-01 수용 3, 저장 API-HAIR-02는 2차).
 */
export function useLabHair() {
  const [hairId, setHairId] = useState(HAIR_NONE)
  const [loading, setLoading] = useState(false)
  const hairUrl = hairUrlOf(hairId)

  const select = useCallback((id: string) => {
    setHairId(id)
    setLoading(hairUrlOf(id) !== null)
  }, [])

  const onHairStatus = useCallback((status: 'ready' | 'error') => {
    setLoading(false)
    if (status === 'error') {
      toastOnce('헤어를 불러오지 못했어요. 잠시 후 다시 골라 주세요.')
      setHairId(HAIR_NONE)
    }
  }, [])

  return { hairId, hairUrl, loading, select, onHairStatus }
}
