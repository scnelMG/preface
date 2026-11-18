import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'
import { Modal } from './Modal'

// jsdom에는 <dialog>의 showModal·close가 없다. 브라우저 동작 중 테스트에 필요한 만큼만 흉내 낸다.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>('button')?.focus()
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="PREFACE STUDIO"
        title="나만의 공간"
      >
        <p>내용</p>
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('열면 제목으로 이름 붙은 대화상자가 뜨고 포커스가 안으로 들어간다', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    const dialog = screen.getByRole('dialog', { name: '나만의 공간' })
    expect(dialog).toHaveAttribute('open')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('휴대폰 시트는 위 두 모서리만 둥글고, 화면 CSS가 알아볼 표시를 단다 (-883)', () => {
    // 한 번에 하나만 연다(둘을 함께 열면 스크롤 잠금 되돌리기 순서가 꼬여 다음 테스트에 남는다)
    const { rerender } = render(<Modal open onClose={() => {}} title="창" placement="sheet" />)
    const sheet = screen.getByRole('dialog', { name: '창' })
    expect(sheet).toHaveAttribute('data-placement', 'sheet')
    expect(sheet).toHaveClass(
      'rounded-t-(--pf-radius-sheet)',
      'rounded-b-none',
      'md:rounded-(--pf-radius-xl)',
    )

    rerender(<Modal open onClose={() => {}} title="창" />)
    expect(screen.getByRole('dialog', { name: '창' })).toHaveAttribute('data-placement', 'center')
  })

  it('닫기 버튼으로 닫힌다', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
  })

  it('ESC(cancel)로 닫힌다', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
  })

  it('뒤 배경을 누르면 닫히고, 카드 안을 누르면 닫히지 않는다', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    await userEvent.click(screen.getByText('내용'))
    expect(screen.getByRole('dialog')).toHaveAttribute('open')

    await userEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
  })

  it('카드 안에서 누른 채 밖으로 끌어 놓으면 닫히지 않는다 (-435)', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    const dialog = screen.getByRole('dialog')

    // 안에서 누르고 배경에서 놓으면 브라우저는 click을 배경(dialog)에 준다
    fireEvent.pointerDown(screen.getByText('내용'))
    fireEvent.click(dialog)
    expect(dialog).toHaveAttribute('open')

    // 그다음 배경을 제대로 누르고 놓으면 닫힌다
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
  })

  it('열린 동안 뒤 화면 스크롤을 막고, 닫으면 되돌린다', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '열기' }))
    expect(document.documentElement.style.overflow).toBe('hidden')
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(document.documentElement.style.overflow).toBe('')
  })
})

// cacheComponents는 떠난 화면을 unmount하지 않고 <Activity mode="hidden">(display: none)으로 남긴다.
// 열린 <dialog>가 그대로 남으면 보이지는 않아도 문서 나머지를 inert로 만들어, 다음 화면 버튼이 눌리지 않는다(-391)
describe('Modal — 화면을 떠났다 돌아올 때(cacheComponents <Activity>)', () => {
  function inActivity(mode: 'visible' | 'hidden') {
    return (
      <Activity mode={mode}>
        <Modal open onClose={() => {}} title="머리 추가">
          <p>내용</p>
        </Modal>
      </Activity>
    )
  }

  it('열린 채 화면이 숨으면 dialog를 닫아 다음 화면을 막지 않는다', () => {
    const { rerender } = render(inActivity('visible'))
    expect(screen.getByRole('dialog', { name: '머리 추가' })).toHaveAttribute('open')

    rerender(inActivity('hidden'))
    expect(document.querySelector('dialog')).not.toHaveAttribute('open')
  })

  it('다시 보이면 다시 연다', () => {
    const { rerender } = render(inActivity('visible'))
    rerender(inActivity('hidden'))
    rerender(inActivity('visible'))
    expect(screen.getByRole('dialog', { name: '머리 추가' })).toHaveAttribute('open')
  })
})
