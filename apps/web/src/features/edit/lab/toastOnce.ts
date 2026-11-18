import { toast } from '@/shared/ui'
import { useToastStore } from '@/shared/ui/Toast'

/** 같은 문구가 이미 떠 있으면 다시 띄우지 않는다(막힌 탭을 여러 번 눌러도 토스트가 쌓이지 않게) */
export function toastOnce(message: string) {
  if (useToastStore.getState().items.some((item) => item.message === message)) return
  toast(message)
}
