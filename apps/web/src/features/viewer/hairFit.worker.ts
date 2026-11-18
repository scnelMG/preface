/// <reference lib="webworker" />
import { createHairFitHandler, type HairFitRequest } from './hairFitCore'

/**
 * 헤어 맞춤 계산(S15P31B204-861). 레이어드컷은 2~4초가 걸려 화면 스레드에서 돌리면 화면이 그동안 멈췄다.
 * 계산은 hairFitCore.ts에 있고 여기서는 메시지를 잇기만 한다. 위치 배열은 복사하지 않고 옮겨(transfer) 주고받는다.
 */
const handle = createHairFitHandler()

self.onmessage = (event: MessageEvent<HairFitRequest>) => {
  const out = handle(event.data)
  if (out) self.postMessage(out.response, out.transfer)
}
