import type { ReactNode } from 'react'
import './controls.css'

/** 묶음 쌓기. 부위를 바꿀 때 key를 바꾸면 묶음이 한 번 차례로 나타난다. */
export function ControlStack({ children }: { children: ReactNode }) {
  return <div className="cc-stack">{children}</div>
}

/**
 * 묶음: 제목 한 줄, 아래 조절 줄. 장식 그림·요약 값은 두지 않는다
 * (값은 각 줄에 이미 있다). 나눔선·상자 없이 간격으로만 나눈다.
 */
export function ControlGroup({
  title,
  index = 0,
  children,
}: {
  title: string
  /** 등장 순서(40ms 간격) */
  index?: number
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="cc-group"
      style={{ '--i': index } as React.CSSProperties}
    >
      <header className="cc-group-head">
        <h3 className="cc-group-title">{title}</h3>
      </header>
      <div className="cc-group-body">{children}</div>
    </section>
  )
}
