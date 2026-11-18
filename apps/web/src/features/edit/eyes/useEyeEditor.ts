'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { newEyeState, restoreEyes, type EyeState } from './state'
interface Session {
  state: EyeState
  committed: EyeState
  past: EyeState[]
  future: EyeState[]
}
const INITIAL = newEyeState()
const EMPTY: Session = { state: INITIAL, committed: INITIAL, past: [], future: [] }
// v2(2026-11-01): 깊이 단위·기본값이 바뀌고 깊이 조절을 뺐다. 이전 탭 이력의 깊이 값을 되살리지 않는다.
const STORAGE_PREFIX = 'preface.eye-history.v2:'

/** 기본 모델 체험은 페이지를 떠날 때 눈 이력도 지운다. */
export function forgetEyeHistory(modelKey: string) {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + modelKey)
  } catch {
    /* 저장소를 쓸 수 없는 환경에서는 메모리만 사라진다. */
  }
}

/** 탭을 닫으면 지워지는 저장소에서 같은 모델 키의 이력만 되살린다. 값은 모두 다시 검사한다. */
function loadSession(modelKey: string): Session {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + modelKey) ?? 'null')
    const committed = restoreEyes(raw?.committed)
    if (!committed) return EMPTY
    const list = (items: unknown) =>
      Array.isArray(items)
        ? items
            .slice(-50)
            .map(restoreEyes)
            .filter((item): item is EyeState => !!item)
        : []
    return { state: committed, committed, past: list(raw.past), future: list(raw.future) }
  } catch {
    return EMPTY
  }
}
function saveSession(modelKey: string, session: Session) {
  try {
    const { committed, past, future } = session
    sessionStorage.setItem(STORAGE_PREFIX + modelKey, JSON.stringify({ committed, past, future }))
  } catch {
    /* 저장소를 쓸 수 없으면 메모리 이력만 쓴다. */
  }
}

/** 모델 ID와 해시별 로컬 이력이다. 드래그 종료를 한 단계로 기록하며 서버에는 저장하지 않는다. */
export function useEyeEditor(modelKey: string) {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const current = useRef(sessions)
  // 서버 렌더와 첫 화면을 같게 두고, 마운트 뒤 같은 탭에 남은 이력을 되살린다.
  useEffect(() => {
    if (current.current[modelKey]) return
    const stored = loadSession(modelKey)
    if (stored === EMPTY) return
    current.current = { ...current.current, [modelKey]: stored }
    setSessions(current.current)
  }, [modelKey])
  const update = useCallback(
    (fn: (session: Session) => Session, persist = false) => {
      const previous = current.current[modelKey] ?? EMPTY
      const session = fn(previous)
      const next = { ...current.current, [modelKey]: session }
      current.current = next
      setSessions(next)
      if (persist && session.committed !== previous.committed) saveSession(modelKey, session)
    },
    [modelKey],
  )
  const preview = useCallback(
    (state: EyeState) => update((session) => ({ ...session, state })),
    [update],
  )
  const commit = useCallback(
    () =>
      update(
        (session) =>
          JSON.stringify(session.state) === JSON.stringify(session.committed)
            ? session
            : {
                state: session.state,
                committed: session.state,
                past: [...session.past, session.committed].slice(-50),
                future: [],
              },
        true,
      ),
    [update],
  )
  /** 이력 단계를 만들지 않고 현재 값을 바꾼다(새로 확인된 안전 한계로 낮출 때). */
  const replace = useCallback(
    (state: EyeState) => update((session) => ({ ...session, state, committed: state }), true),
    [update],
  )
  const undo = useCallback(
    () =>
      update((session) => {
        const state = session.past.at(-1)
        return state
          ? {
              state,
              committed: state,
              past: session.past.slice(0, -1),
              future: [...session.future, session.committed],
            }
          : session
      }, true),
    [update],
  )
  const redo = useCallback(
    () =>
      update((session) => {
        const state = session.future.at(-1)
        return state
          ? {
              state,
              committed: state,
              past: [...session.past, session.committed],
              future: session.future.slice(0, -1),
            }
          : session
      }, true),
    [update],
  )
  const reset = useCallback(() => {
    preview(newEyeState())
    commit()
  }, [preview, commit])
  /** 모든 모델의 이력을 메모리·저장소에서 지운다(메인 체험을 떠날 때, S15P31B204-848) */
  const clear = useCallback(() => {
    for (const key of Object.keys(current.current)) forgetEyeHistory(key)
    current.current = {}
    setSessions({})
  }, [])
  const session = sessions[modelKey] ?? EMPTY
  return {
    ...session,
    preview,
    commit,
    replace,
    undo,
    redo,
    reset,
    clear,
    canUndo: session.past.length > 0,
    canRedo: session.future.length > 0,
  }
}
