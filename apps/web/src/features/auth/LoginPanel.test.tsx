import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, routeFetch } from './testUtils'
import { LoginOptions } from './LoginPanel'

const AUTHORIZE = { authorizeUrl: 'https://kauth.example/authorize', state: 'state-1' }

let navigate: ReturnType<typeof vi.fn<(url: string) => void>>

beforeEach(() => {
  navigate = vi.fn<(url: string) => void>()
  routeFetch([['GET', '/auth/oauth/kakao/authorize-url', ok(AUTHORIZE)]])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function buttons() {
  return [
    screen.getByRole('button', { name: '카카오 로그인' }),
    screen.getByRole('button', { name: 'Google 로그인' }),
  ]
}

/** 카카오를 눌러 제공자 화면으로 넘어간 상태(두 버튼이 잠긴다)까지 간다 */
async function startKakao() {
  await userEvent.click(buttons()[0])
  expect(navigate).toHaveBeenCalledWith(AUTHORIZE.authorizeUrl)
  for (const button of buttons()) expect(button).toBeDisabled()
}

describe('소셜 로그인 버튼 잠금', () => {
  it('bfcache로 돌아오면(pageshow persisted) 두 버튼을 다시 누를 수 있다', async () => {
    render(<LoginOptions navigate={navigate} />)
    await startKakao()

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })

    for (const button of buttons()) expect(button).toBeEnabled()
  })

  it('처음 여는 pageshow(persisted 아님)에는 잠금을 그대로 둔다', async () => {
    render(<LoginOptions navigate={navigate} />)
    await startKakao()

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
    })

    for (const button of buttons()) expect(button).toBeDisabled()
  })

  it('숨었다가 다시 보이면(Activity) 두 버튼을 다시 누를 수 있다', async () => {
    const view = render(
      <Activity mode="visible">
        <LoginOptions navigate={navigate} />
      </Activity>,
    )
    await startKakao()

    view.rerender(
      <Activity mode="hidden">
        <LoginOptions navigate={navigate} />
      </Activity>,
    )
    view.rerender(
      <Activity mode="visible">
        <LoginOptions navigate={navigate} />
      </Activity>,
    )

    for (const button of buttons()) expect(button).toBeEnabled()
  })
})
