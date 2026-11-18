import { create } from 'zustand'

/**
 * "로그인 모달을 띄워 달라"는 신호. 화면 여러 곳이 같은 모달을 연다.
 *
 * - 헤더의 "로그인" 버튼 (-273 SiteHeader)
 * - 비로그인으로 보호 라우트에 들어왔을 때의 가드 (-274)
 *
 * 모달 자체(P3-09 내용·소셜 버튼)는 features/auth/LoginModal이 그린다. 여기서는 열림 여부와
 * 로그인 뒤 돌아갈 곳만 들고 있는다. 모달을 그리는 쪽은 `open`을 보고, 닫을 때 `close()`를 부른다.
 */
interface LoginPromptState {
  open: boolean
  /** 로그인을 마치면 돌아갈 경로. 없으면 지금 화면에 머문다 */
  returnTo: string | null
  show: (options?: { returnTo?: string }) => void
  close: () => void
}

export const useLoginPrompt = create<LoginPromptState>((set) => ({
  open: false,
  returnTo: null,
  show: (options) => set({ open: true, returnTo: options?.returnTo ?? null }),
  close: () => set({ open: false, returnTo: null }),
}))
