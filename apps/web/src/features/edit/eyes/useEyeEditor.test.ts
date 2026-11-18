import { renderHook, act, waitFor } from '@testing-library/react'
import { it, expect } from 'vitest'
import { useEyeEditor } from './useEyeEditor'
import { changeEyes } from './state'
it('미리보기 여러 번은 이력 한 건이고 되돌리기·다시 실행을 지원한다', () => {
  const { result } = renderHook(() => useEyeEditor('one:hash'))
  act(() => {
    result.current.preview(
      changeEyes(result.current.state, 'both', { type: 'style', style: 'inline' }),
    )
  })
  act(() => {
    result.current.preview(
      changeEyes(result.current.state, 'both', { type: 'control', control: 'crease', value: 70 }),
    )
    result.current.commit()
  })
  expect(result.current.past).toHaveLength(1)
  act(() => result.current.undo())
  expect(result.current.state.L.enabled).toBe(false)
  act(() => result.current.redo())
  expect(result.current.state.L.style).toBe('inline')
  expect(result.current.state.L.values.crease).toBe(70)
})
it('모델 해시가 바뀌면 기존 모델의 눈 설정과 이력을 적용하지 않는다', () => {
  const { result, rerender } = renderHook(({ id }) => useEyeEditor(id), {
    initialProps: { id: 'one:hash' },
  })
  act(() => {
    result.current.preview(
      changeEyes(result.current.state, 'R', { type: 'style', style: 'outline' }),
    )
    result.current.commit()
  })
  rerender({ id: 'one:new-hash' })
  expect(result.current.state.R.enabled).toBe(false)
  expect(result.current.canUndo).toBe(false)
  rerender({ id: 'one:hash' })
  expect(result.current.state.R.style).toBe('outline')
  expect(result.current.canUndo).toBe(true)
})

it('같은 탭에서는 모델 키별 이력을 되살리고 다른 키에는 쓰지 않는다', async () => {
  sessionStorage.clear()
  const first = renderHook(() => useEyeEditor('keep:hash'))
  act(() => {
    first.result.current.preview(
      changeEyes(first.result.current.state, 'both', {
        type: 'control',
        control: 'inner',
        value: 12,
      }),
    )
    first.result.current.commit()
  })
  first.unmount()
  const again = renderHook(() => useEyeEditor('keep:hash'))
  await waitFor(() => expect(again.result.current.state.L.values.inner).toBe(12))
  expect(again.result.current.canUndo).toBe(true)
  const other = renderHook(() => useEyeEditor('other:hash'))
  expect(other.result.current.state.L.values.inner).toBe(0)
})
