import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialLoginButton } from './SocialLoginButton'

describe('SocialLoginButton', () => {
  it('카카오는 디자인 가이드 레이블 "카카오 로그인"과 공식 심볼을 쓴다', () => {
    const { container } = render(<SocialLoginButton provider="kakao" />)
    expect(screen.getByRole('button', { name: '카카오 로그인' })).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/design/auth/kakao-symbol.svg')
  })

  it('Google은 "Sign in with Google" 한국어 문구와 공식 G 로고를 쓴다', () => {
    const { container } = render(<SocialLoginButton provider="google" />)
    expect(screen.getByRole('button', { name: 'Google 로그인' })).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/design/auth/google-g.svg')
  })

  it('로고는 장식이라 접근성 이름에 섞이지 않는다', () => {
    const { container } = render(<SocialLoginButton provider="google" />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})
