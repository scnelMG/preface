import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { ServiceSection } from './ServiceSection'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))

beforeEach(() => {
  push.mockReset()
  useLoginPrompt.setState({ open: false, returnTo: null })
  useAuthStore.setState({ status: 'anonymous', me: null })
})

function list() {
  return screen.getByRole('list', { name: '서비스 목록' })
}

describe('서비스 섹션', () => {
  it('처음에는 얼굴 · 스타일 5개와 3D 얼굴 커스텀 상세를 보여 준다', () => {
    render(<ServiceSection />)

    expect(within(list()).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('heading', { level: 3, name: '3D 얼굴 커스텀' })).toBeVisible()
    expect(screen.getByText('체중 · 이용 가능')).toBeVisible()
    expect(screen.getByRole('link', { name: /3D 얼굴 체험하기/ })).toHaveAttribute('href', '/lab')
  })

  it('목록에서 고르면 상세가 바뀌고, 예정 기능은 버튼 대신 공개 예정 안내', async () => {
    render(<ServiceSection />)

    await userEvent.click(within(list()).getByRole('link', { name: /안경 피팅/ }))

    expect(screen.getByRole('heading', { level: 3, name: '안경 피팅' })).toBeVisible()
    expect(screen.getByText('공개 예정이에요.')).toBeVisible()
    expect(within(list()).getByRole('link', { name: /안경 피팅/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('탭을 바꾸면 그 분류의 항목이 나온다', async () => {
    render(<ServiceSection />)

    await userEvent.click(screen.getByRole('tab', { name: /AI 도우미/ }))

    expect(within(list()).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 3, name: 'AI 실장님 상담' })).toBeVisible()
  })

  it('보기 필터로 예정만 고르면 첫 예정 항목을 보여 준다', async () => {
    render(<ServiceSection />)

    await userEvent.click(
      within(screen.getByRole('group', { name: '보기' })).getByRole('button', { name: '예정' }),
    )

    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list()).queryByRole('link', { name: /3D 얼굴 커스텀/ })).not.toBeInTheDocument()
    expect(within(list()).queryByRole('link', { name: /헤어 스타일/ })).not.toBeInTheDocument()
    expect(within(list()).queryByRole('link', { name: /표정 트래킹/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '안경 피팅' })).toBeVisible()
  })

  it('목록 배지: 3D 얼굴 커스텀·헤어 스타일·표정 트래킹 모두 이용 가능(-878)', () => {
    render(<ServiceSection />)

    for (const name of [/3D 얼굴 커스텀/, /헤어 스타일/, /표정 트래킹/])
      expect(within(list()).getByRole('link', { name })).toHaveTextContent('이용 가능')
  })

  it('비로그인이 헤어 스타일 버튼을 누르면 로그인 모달을 열고 내 작업실로 돌아온다', async () => {
    render(<ServiceSection />)
    await userEvent.click(within(list()).getByRole('link', { name: /헤어 스타일/ }))

    expect(screen.getByText(/로그인하면 내 작업실 편집실에서/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /내 작업실에서 해 보기/ }))

    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio' })
    expect(push).not.toHaveBeenCalled()
  })

  it('비로그인이 회원 전용 버튼을 누르면 로그인 모달을 연다', async () => {
    render(<ServiceSection />)
    await userEvent.click(screen.getByRole('tab', { name: /AI 도우미/ }))

    await userEvent.click(screen.getByRole('button', { name: /내 작업실에서 상담하기/ }))

    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio' })
    expect(push).not.toHaveBeenCalled()
  })

  it('회원은 바로 이동한다', async () => {
    useAuthStore.setState({ status: 'member' })
    render(<ServiceSection />)
    await userEvent.click(screen.getByRole('tab', { name: /AI 도우미/ }))

    await userEvent.click(screen.getByRole('button', { name: /내 작업실에서 상담하기/ }))

    expect(push).toHaveBeenCalledWith('/studio')
    expect(useLoginPrompt.getState().open).toBe(false)
  })

  it('다른 화면에 다녀오면(Activity) 얼굴 · 스타일과 3D 얼굴 커스텀으로 돌아온다', async () => {
    const view = render(
      <Activity mode="visible">
        <ServiceSection />
      </Activity>,
    )
    await userEvent.click(
      within(screen.getByRole('group', { name: '보기' })).getByRole('button', { name: '예정' }),
    )
    await userEvent.click(screen.getByRole('tab', { name: /AI 도우미/ }))

    view.rerender(
      <Activity mode="hidden">
        <ServiceSection />
      </Activity>,
    )
    view.rerender(
      <Activity mode="visible">
        <ServiceSection />
      </Activity>,
    )

    expect(screen.getByRole('tab', { name: /얼굴 · 스타일/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      within(screen.getByRole('group', { name: '보기' })).getByRole('button', {
        name: '전체 상태',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(within(list()).getAllByRole('listitem')).toHaveLength(5)
    expect(within(list()).getByRole('link', { name: /3D 얼굴 커스텀/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('heading', { level: 3, name: '3D 얼굴 커스텀' })).toBeVisible()
  })
})
