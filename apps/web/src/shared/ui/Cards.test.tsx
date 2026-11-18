import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatRecordDate, LabServiceRow, ModelTile, RecordCard } from './Cards'

describe('formatRecordDate', () => {
  it('Figma RecordCard 모양 "10. 21. 오후 04:01" (서울 시간)', () => {
    expect(formatRecordDate('2026-10-21T07:01:00Z')).toBe('10. 21. 오후 04:01')
  })
})

describe('RecordCard', () => {
  it('그림을 누르면 시안으로 가고, 삭제 버튼은 제목을 이름에 담는다', async () => {
    const onDelete = vi.fn()
    render(
      <RecordCard
        href="/simulations/s-1"
        category="밸런스 스터디"
        title="원본 비교"
        updatedAt="2026-10-21T07:01:00Z"
        onDelete={onDelete}
      />,
    )
    expect(screen.getByRole('link', { name: '원본 비교 시안 열기' })).toHaveAttribute(
      'href',
      '/simulations/s-1',
    )
    // 이름 바꾸기·삭제는 ⋮ 메뉴 하나(2026-10-31)
    await userEvent.click(screen.getByRole('button', { name: '원본 비교 메뉴' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '삭제' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('ModelTile', () => {
  it('선택 상태를 aria-pressed로 알린다. 추가 칸은 선택 개념이 없다', () => {
    render(
      <>
        <ModelTile
          kind="selected"
          index="01"
          title="오리지널"
          subtitle="공개 샘플"
          onClick={() => {}}
        />
        <ModelTile
          kind="default"
          index="02"
          title="라인 스터디"
          subtitle="비교 프리셋"
          onClick={() => {}}
        />
        <ModelTile
          kind="add"
          title="새로운 머리"
          subtitle="나의 모델을 추가하세요."
          onClick={() => {}}
        />
      </>,
    )
    expect(screen.getByRole('button', { name: /오리지널/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /라인 스터디/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: /새로운 머리/ })).not.toHaveAttribute('aria-pressed')
  })
})

describe('LabServiceRow', () => {
  it('펼침 상태를 aria-expanded로 알리고 누르면 onClick', async () => {
    const onClick = vi.fn()
    render(
      <LabServiceRow
        icon="User"
        label="3D 얼굴 커스텀"
        status="partial"
        expanded
        onClick={onClick}
      />,
    )
    const row = screen.getByRole('button', { name: /3D 얼굴 커스텀/ })
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
