import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CaptureBangsConfirm, CaptureCheckDone, CaptureChecks } from './CaptureChecks'
import type { CheckItem } from './guideEngine'

const ITEMS: CheckItem[] = [
  { key: 'distance', label: '거리', state: 'ok' },
  { key: 'position', label: '위치', state: 'bad' },
  { key: 'front', label: '정면', state: 'wait' },
  { key: 'bangs', label: '앞머리', state: 'ok' },
  { key: 'glasses', label: '안경', state: 'skip' },
]

describe('검사 목록', () => {
  it('항목마다 이름과 상태를 글자로 보인다(색만으로 구분하지 않는다)', () => {
    render(<CaptureChecks checks={ITEMS} />)
    const list = screen.getByRole('list', { name: '촬영 전 검사' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      '거리 ✓',
      '위치 ✕',
      '정면 …',
      '앞머리 ✓',
      '안경 -',
    ])
    expect(rows.map((row) => row.dataset.state)).toEqual(['ok', 'bad', 'wait', 'ok', 'skip'])
    expect(within(rows[1]!).getByText('✕')).toHaveAttribute('aria-label', '고쳐야 함')
  })

  it('검사 완료는 상태 알림으로 크게 보인다', () => {
    render(<CaptureCheckDone />)
    expect(screen.getByRole('status')).toHaveTextContent('검사 완료 ✓')
  })

  it('앞머리를 자동으로 못 재면 직접 확인을 묻고, 누르면 알린다', async () => {
    const onConfirm = vi.fn()
    render(<CaptureBangsConfirm onConfirm={onConfirm} />)
    expect(screen.getByText('이마가 보이게 앞머리를 올리고, 안경을 벗었나요?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '네, 확인했어요' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
