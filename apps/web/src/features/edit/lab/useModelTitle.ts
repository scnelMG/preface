import { useEffect, useState } from 'react'
import { listFaceModels } from '@/features/studio/api'
import { DEFAULT_HEAD_TITLE, ownHeadTitle } from '@/features/studio/heads'

/** 모델 목록 한 쪽 크기(API-HIS-01 최대 50) */
const PAGE_SIZE = 50
/** 모델을 찾을 때 넘겨 볼 최대 쪽 수. 그 밖이면 '내 모델'로 둔다 */
const MAX_PAGES = 10

/**
 * 시안을 만든 모델의 이름(-812). 편집 도구 줄 제목 아래에 보인다.
 * 시안·모델 상세 응답에는 모델 이름이 없어서 작업실과 같은 모델 목록(API-HIS-01)에서 찾는다.
 * 작업실에서 이름을 바꾸면 편집실을 열 때마다 목록을 새로 읽어 바뀐 이름이 보인다(S15P31B204-838).
 * 첫 쪽(50개)에 없으면 다음 쪽을 이어 본다(최대 MAX_PAGES쪽, -838).
 * 찾기 전·못 찾으면(목록 실패, 범위 밖) '내 모델'. 이름 표기는 작업실과 같다(`ownHeadTitle`, 이름이 비면 '내 모델').
 */
export function useModelTitle(faceModelId: string | null | undefined): string {
  const [found, setFound] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    if (!faceModelId) return
    const controller = new AbortController()
    const find = async () => {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await listFaceModels({ page, size: PAGE_SIZE }, controller.signal)
        const model = result.items.find((item) => item.faceModelId === faceModelId)
        if (model) {
          setFound({ id: faceModelId, title: ownHeadTitle(model.title) })
          return
        }
        const last =
          result.items.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= result.totalElements
        if (last) return
      }
    }
    find().catch(() => undefined)
    return () => controller.abort()
  }, [faceModelId])

  return found && found.id === faceModelId ? found.title : DEFAULT_HEAD_TITLE
}
