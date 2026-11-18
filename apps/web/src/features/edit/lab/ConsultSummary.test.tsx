import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ConsultSummary } from './ConsultSummary'

it('별도 입력 없이 시작한 고민은 사용자가 말한 그대로 요약한다', () => {
  render(
    <ConsultSummary
      items={[
        { id: '1', role: 'user', content: '코끝은 그대로 두고 콧볼 쪽을 보고 싶어요.' },
        {
          id: '2',
          role: 'assistant',
          content: '정면에서 비교해 보세요.',
          comparisonCode: 'nose.alar_width',
        },
      ]}
    />,
  )
  fireEvent.click(screen.getByText('상담 내용 정리'))
  expect(screen.getByText('코끝은 그대로 두고 콧볼 쪽을 보고 싶어요.')).toBeVisible()
  expect(screen.getByText('아직 적용한 변경이 없어요.')).toBeVisible()
})

it('되돌리기 뒤의 현재 저장값은 상담 적용 이력과 분리한다', () => {
  render(
    <ConsultSummary
      savedWeights={{ 'nose.alar_width': 0 }}
      items={[
        {
          id: 'applied',
          role: 'assistant',
          content: '',
          applyResult: {
            summary: '콧볼을 +10%로 변경',
            seq: 1,
            applied: [{ code: 'nose.alar_width', from: 0, to: 0.1, limited: false }],
            skipped: [],
            limited: false,
          },
        },
      ]}
    />,
  )
  fireEvent.click(screen.getByText('상담 내용 정리'))
  expect(screen.getByText('콧볼을 +10%로 변경')).toBeVisible()
  expect(screen.getByText(/현재 저장값: .* 0%/)).toBeVisible()
})

it('확인한 조건과 저장 결과만 복사하고 원문 링크는 제외한다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  try {
    render(
      <ConsultSummary
        items={[
          {
            id: '1',
            role: 'user',
            content: '상담 목표: 코 옆선 https://example.com/sample / 유지할 부위: 코끝',
          },
          { id: '2', role: 'assistant', content: '턱 미리보기' },
          {
            id: '3',
            role: 'assistant',
            content: '',
            applyResult: { summary: '콧볼 변경', seq: 1, applied: [], skipped: [], limited: false },
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByText('상담 내용 정리'))
    fireEvent.click(screen.getByRole('button', { name: '상담 요약 복사' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('콧볼 변경')),
    )
    expect(writeText.mock.calls[0][0]).toContain('코끝')
    expect(writeText.mock.calls[0][0]).toContain('되돌린 변경도 포함될 수 있어요')
    expect(writeText.mock.calls[0][0]).not.toMatch(/https|턱 미리보기/)
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
