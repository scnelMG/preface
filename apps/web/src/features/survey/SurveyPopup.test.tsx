import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SURVEY_ENDS_AT } from './schedule'
import { clearSurveyNotice, SurveyPopup } from './SurveyPopup'

// jsdom에는 <dialog>의 showModal·close가 없다(shared/ui/Modal.test.tsx와 같은 흉내)
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  // 설문 기간 안으로 시계를 맞춘다(마감 뒤에는 띄우지 않는다, S15P31B204-851)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SURVEY_ENDS_AT - 60_000)
})

afterEach(() => {
  cleanup()
  clearSurveyNotice()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const TITLE = '3D가 완성됐어요'

describe('SurveyPopup', () => {
  it('3D가 완성되면 수정 뒤 설문을 안내하고, 아직이면 띄우지 않는다', () => {
    const { rerender } = render(<SurveyPopup done={false} />)
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()

    rerender(<SurveyPopup done />)
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
    expect(screen.getByText(/직접 바꿔 본 뒤 설문에 참여해/)).toBeTruthy()
  })

  it('설문 링크는 열지 않고 작업실로 보낸다', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SurveyPopup done />)

    const link = screen.getByRole('link', { name: '작업실로 가기' })
    expect(link.getAttribute('href')).toBe('/studio')
    expect(open).not.toHaveBeenCalled()
  })

  it('사용자(기기)당 한 번만 띄운다 — 3D를 다시 만들어도 다시 띄우지 않는다', () => {
    render(<SurveyPopup done />)
    expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy()
    cleanup()

    render(<SurveyPopup done />)
    expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull()
  })
})
