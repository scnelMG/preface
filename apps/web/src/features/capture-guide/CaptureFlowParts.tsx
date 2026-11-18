import { Icon } from '@/shared/ui'
import { CAPTURE_PREP, CAPTURE_PREP_NOTE } from './guideContent'

/**
 * 새 모델(PC) 찍기 전 준비(2026-10-31). 모양은 features/capture-guide/capture-flow.css.
 * 할 것(✓)과 피할 것(✕)을 시연 영상과 같은 선 그림체의 그림 넷 + 제목·한 줄 설명으로, 아래에 찍는 방법·올릴 파일 한 줄.
 */
export function PrepCards() {
  return (
    <>
      <ul className="pf-prep-cards" aria-label="찍기 전에 확인해요">
        {CAPTURE_PREP.map((item) => (
          <li key={item.title} data-kind={item.kind}>
            <span className="pf-prep-icon pf-prep-art" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- 선 그림(svg) 그대로 */}
              <img src={item.art} alt="" />
            </span>
            <span className="pf-prep-text">
              {/* ✓·✕는 그림에 겹치지 않게 제목 앞에(✓ 잉크, ✕만 위험 색) */}
              <strong>
                <span className="pf-prep-mark" aria-hidden="true">
                  <Icon name={item.kind === 'do' ? 'Check' : 'X'} size={13} />
                </span>
                <span className="sr-only">{item.kind === 'do' ? '해요: ' : '피해요: '}</span>
                {item.title}
              </strong>
              <span>{item.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="pf-prep-note">{CAPTURE_PREP_NOTE}</p>
    </>
  )
}
