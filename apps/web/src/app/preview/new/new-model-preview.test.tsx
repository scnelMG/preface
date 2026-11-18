import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewModelPreview } from './new-model-preview'
vi.mock('../preview-nav', () => ({ PreviewNav: () => null }))
vi.mock('./phone-guide', () => ({ PhoneGuide: () => <div>촬영 방향 안내</div> }))
describe('오프라인 촬영 연결 시안', () => {
  it('인증이나 서버 요청 없이 QR 대기 화면을 바로 보여준다', () => {
    render(<NewModelPreview />)
    expect(screen.getByRole('img', { name: '화면 검토용 QR 코드' })).toBeInTheDocument()
    expect(screen.getByText(/Google 로그인 상태/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '기본 모델' })).not.toBeInTheDocument()
    expect(screen.queryByText('새 모델 만들기')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '내 작업실' })).not.toBeInTheDocument()
  })
  it('연결된 상태와 대기 상태를 실제 세션 없이 전환한다', () => {
    render(<NewModelPreview />)
    fireEvent.click(screen.getByRole('button', { name: '연결된 화면 미리보기' }))
    expect(screen.getByRole('heading', { name: '휴대폰이 연결됐어요.' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '화면 검토용 QR 코드' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '연결 대기 화면으로' }))
    expect(screen.getByRole('img', { name: '화면 검토용 QR 코드' })).toBeInTheDocument()
  })
})
