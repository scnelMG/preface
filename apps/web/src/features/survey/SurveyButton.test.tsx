import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurveyButton } from './SurveyButton'
import { SURVEY_ENDS_AT } from './schedule'
import { SURVEY_URL } from './SurveyPopup'

// jsdom에는 <dialog>의 showModal·close가 없다(Modal.test.tsx와 같은 흉내)
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
  localStorage.clear()
  // 설문 기간 안으로 시계를 맞춘다(마감 뒤에는 숨는다, S15P31B204-851). 타이머는 진짜를 쓴다
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SURVEY_ENDS_AT - 60_000)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SurveyButton', () => {
  it('설문을 새 탭에서 연다. 경품은 선물 아이콘이 알리고 마우스 설명은 없다', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SurveyButton />)

    const button = screen.getByRole('button', { name: /설문 참여하기\(경품, 새 탭에서 열림\)/ })
    expect(button).not.toHaveAttribute('title')
    expect(button.querySelector('.pf-survey-gift')).not.toBeNull()
    await userEvent.hover(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await userEvent.click(button)

    expect(open).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledWith(SURVEY_URL, '_blank', 'noopener,noreferrer')
  })

  it('X는 바로 숨기지 않고 확인을 받는다. 취소하면 그대로, 숨기면 이 기기에서 사라진다', async () => {
    render(<SurveyButton />)

    await userEvent.click(screen.getByRole('button', { name: '설문 버튼 숨기기' }))
    const dialog = screen.getByRole('dialog', { name: '설문 버튼을 숨길까요?' })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.getByRole('button', { name: /설문 참여하기/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '설문 버튼 숨기기' }))
    await userEvent.click(screen.getByRole('button', { name: '숨기기' }))
    expect(screen.queryByRole('button', { name: /설문 참여하기\(경품/ })).not.toBeInTheDocument()
    expect(localStorage.getItem('preface.survey.hidden')).toBe('1')
  })

  it('확인 창에서 바로 참여할 수도 있다(숨기지 않는다)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SurveyButton />)

    await userEvent.click(screen.getByRole('button', { name: '설문 버튼 숨기기' }))
    await userEvent.click(screen.getByRole('button', { name: '설문 참여하기' }))
    expect(open).toHaveBeenCalledOnce()
    expect(localStorage.getItem('preface.survey.hidden')).toBeNull()
  })
})

describe('설문 참여 모양 (S15P31B204-770)', () => {
  it('보라(accent)로 채운 큰 알약에 흰 글자다(refine.css)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/layout/refine.css'), 'utf8')
    const rule = (selector: string) => {
      const start = css.indexOf(`\n${selector} {`)
      expect(start, selector).toBeGreaterThan(-1)
      return css.slice(start, css.indexOf('\n}', start))
    }
    const chip = rule('.pf-survey-chip')
    expect(chip).toContain('height: 36px')
    expect(chip).toMatch(/background: linear-gradient\([^;]*var\(--pf-accent\)/)
    const main = rule('.pf-survey-main')
    expect(main).toContain('color: white')
    expect(main).toContain('font-size: 14px')
  })
})
