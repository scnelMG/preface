import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// CI 러너는 한 PC에서 여러 MR의 lint·test·build를 같이 돌려 느리다. findBy*·waitFor 기본값(1초)으로는
// 요청이 여러 번 이어지는 화면이 제때 안 그려져 실패한 적이 있다. testTimeout(vitest.config.ts)보다 짧게 둔다
configure({ asyncUtilTimeout: 5000 })

afterEach(() => {
  cleanup()
  // 테스트 안에서 건 spy(console.error 숨김 등)가 다음 테스트로 새지 않게 한다
  vi.restoreAllMocks()
})

// jsdom에는 <dialog>의 showModal·close가 없다. 화면이 들어오자마자 팝업을 여는 곳(휴대폰 촬영 가이드 "찍기 전에", -566)이
// 있어 그 화면을 거치는 테스트 모두에 필요하다. 브라우저처럼 열 때 첫 버튼으로 포커스를 옮긴다(shared/ui/Modal.test.tsx와 같은 흉내)
// node 환경 테스트(토큰·에셋 검사)에는 DOM이 없어 건너뛴다
if (typeof HTMLDialogElement !== 'undefined') {
  const dialogProto = HTMLDialogElement.prototype
  dialogProto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>('button')?.focus()
  }
  dialogProto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}
