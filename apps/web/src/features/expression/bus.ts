/**
 * 표정 프레임을 조작 UI(웹캠·풀이, DOM)에서 3D 장면 안의 적용 레이어(react-three-fiber)로 넘기는 통로.
 * 받는 쪽은 뷰어의 모델마다 하나씩이다(수정한 모델, 원본 보기용 모델). 프레임은 초당 수십 번 오므로 React 상태로 넘기지 않는다.
 */
import type { ExpressionFrame } from './tracker'

interface Sink {
  /** 표정 한 프레임을 얹는다. null = 무표정 */
  apply(frame: ExpressionFrame | null): void
  /** 다른 편집이 피부 위치를 방금 다시 썼다: 그 값을 기준으로 삼고 지금 표정을 바로 다시 얹는다 */
  rebase(skin: Float32Array | null): void
}
const sinks = new Set<Sink>()

export const expressionBus = {
  /** 적용 레이어가 붙는다. 돌려받은 함수로 뗀다 */
  attach(next: Sink): () => void {
    sinks.add(next)
    return () => void sinks.delete(next)
  },
  /** null = 표정 없음(무표정으로 되돌린다) */
  emit(frame: ExpressionFrame | null): void {
    for (const sink of sinks) sink.apply(frame)
  },
  /**
   * 3D 뷰어가 피부 위치를 쓴 **같은 자리에서** 부른다(그리기 전). 따로 effect로 처리하면 한 프레임 동안 표정이
   * 빠진 얼굴이 그려져, 슬라이더를 움직일 때마다 무표정으로 갔다가 돌아오는 것처럼 보인다(2026-11-12)
   */
  rebase(skin: Float32Array | null): void {
    for (const sink of sinks) sink.rebase(skin)
  },
}

/**
 * After 모델만 쓰는(복제한) 형상인지. 원본 장면·Before와 나눠 쓰는 형상에 정점을 쓰면 Before까지 바뀌고, 모델을 다시
 * 만들 때(코 리그가 오는 등) 변형된 값이 새 기준으로 굳는다. three의 `geometry.clone()`은 `userData`를 **같은 객체로**
 * 넘기므로 `userData`에 표시하면 원본에도 표시가 생긴다(2026-11-12: 슬라이더를 움직이면 눈알이 어긋난 원인) → 따로 적는다.
 */
const afterOnly = new WeakSet<object>()
export const markAfterOnly = (geometry: object) => void afterOnly.add(geometry)
export const isAfterOnly = (geometry: object) => afterOnly.has(geometry)
