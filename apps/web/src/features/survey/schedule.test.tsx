import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isSurveyOpen, SURVEY_ENDS_AT, useSurveyOpen } from './schedule'
import { clearSurveyAfterDone, shouldAskSurveyAfterDone, SurveyAfterDone } from './SurveyAfterDone'
import { SurveyButton } from './SurveyButton'
import { clearSurveyNotice, SurveyPopup } from './SurveyPopup'

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

afterEach(() => {
  cleanup()
  clearSurveyNotice()
  clearSurveyAfterDone()
  localStorage.clear()
  vi.useRealTimers()
})

const MINUTE = 60_000

function at(time: number) {
  vi.useFakeTimers()
  vi.setSystemTime(time)
}

function Probe() {
  return <p>{useSurveyOpen() ? 'open' : 'closed'}</p>
}

describe('설문 마감(S15P31B204-851)', () => {
  it('2026-11-17 0시(KST) = 2026-11-16 15:00 UTC에 닫는다', () => {
    expect(SURVEY_ENDS_AT).toBe(Date.parse('2026-11-16T15:00:00Z'))
    expect(isSurveyOpen(SURVEY_ENDS_AT - 1)).toBe(true)
    expect(isSurveyOpen(SURVEY_ENDS_AT)).toBe(false)
    expect(isSurveyOpen(SURVEY_ENDS_AT + MINUTE)).toBe(false)
  })

  it('마감 전에는 설문 칩·3D 완성 안내·완료 뒤 설문 창이 보인다(-844)', () => {
    at(SURVEY_ENDS_AT - MINUTE)
    render(
      <>
        <SurveyButton />
        <SurveyPopup done />
        <SurveyAfterDone open onClose={() => {}} />
      </>,
    )
    expect(screen.getByRole('button', { name: /설문 참여하기\(경품/ })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '3D가 완성됐어요' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '설문조사 하러 가기' })).toBeInTheDocument()
    expect(shouldAskSurveyAfterDone()).toBe(true)
  })

  it('마감 뒤에는 모두 숨기고, 완료 뒤 설문 창은 그리지 않고 바로 닫는다(-844)', () => {
    at(SURVEY_ENDS_AT)
    const onClose = vi.fn()
    const { container } = render(
      <>
        <SurveyButton />
        <SurveyPopup done />
        <SurveyAfterDone open onClose={onClose} />
      </>,
    )
    // 닫힌 <dialog> 안의 글은 DOM에 남으므로 보이는 역할로 본다
    expect(screen.queryByRole('button', { name: /설문/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('dialog[open]')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
    // 편집실 완료도 설문을 묻지 않는다(-844)
    expect(shouldAskSurveyAfterDone()).toBe(false)
    // 띄우지 않은 안내는 본 것으로 남기지 않는다
    expect(localStorage.getItem('preface.survey.v2.notice')).toBeNull()
  })

  it('화면을 열어 둔 채 마감 시각을 넘기면 저절로 숨는다', () => {
    at(SURVEY_ENDS_AT - 2 * MINUTE + 1234)
    const onClose = vi.fn()
    render(
      <>
        <Probe />
        <SurveyButton />
        <SurveyAfterDone open onClose={onClose} />
      </>,
    )
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /설문 참여하기\(경품/ })).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(MINUTE))
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(MINUTE))
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /설문 참여하기/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '설문조사 하러 가기' })).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('기기가 잠들어 예약 타이머를 놓쳐도 1분마다 다시 확인해 닫는다', () => {
    at(SURVEY_ENDS_AT - 10 * MINUTE)
    render(<Probe />)
    expect(screen.getByText('open')).toBeInTheDocument()

    // 타이머 없이 시계만 마감 뒤로 건너뛴다(절전에서 깨어난 경우)
    vi.setSystemTime(SURVEY_ENDS_AT + 5 * MINUTE)
    act(() => vi.advanceTimersByTime(MINUTE))
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('서버에서는 숨긴 상태로 그린다(시각은 브라우저에서 정한다)', () => {
    at(SURVEY_ENDS_AT - MINUTE)
    expect(renderToString(<Probe />)).toContain('closed')
    expect(renderToString(<SurveyButton />)).not.toContain('설문')
  })
})
