'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMarkVisited } from './firstVisit'
import './stage/landing-stage.css'

/**
 * 랜딩(소개, `/about`) — 2026-10-31 별도로 만들던 랜딩(.run/landing-video/landing-r3f)으로 교체.
 *
 * 스크롤 하나로 이어지는 구간 6개: 첫 화면 → 468개 점으로 읽기 → 형태 맞추기 → 어느 각도에서든 → 코 미리보기 → 끝.
 * 3D 무대(stage/LandingStage)는 페이지 뒤에 고정되고, 문구는 여기서 일반 HTML로 그린다.
 * 서버 그림·읽기 프로그램·WebGL이 안 되는 기기에서도 문구와 행동은 그대로 읽힌다.
 *
 * - 머리줄·바닥줄은 서비스 것을 쓴다(원본 랜딩의 자체 머리줄은 뺐다). "시작하기"는 서비스 메인(체험)으로 간다.
 * - 처음 온 비로그인 사용자는 메인에서 여기로 한 번 보내진다. 도착하면 방문으로 기록한다(`firstVisit.ts`).
 * - 인물은 메타휴먼 가상 인물(홍보물 전용 예외를 로컬 시안에 임시 사용). 페이지 끝에 밝힌다.
 */
const LandingStage = dynamic(() => import('./stage/LandingStage').then((m) => m.LandingStage), {
  ssr: false,
})

const HERO_LINES = ['휴대폰 영상 하나로,', '나의 3D 얼굴.'] as const

export function LandingPage() {
  useMarkVisited()

  return (
    <div className="pf-ls">
      <LandingStage />

      <section data-landing-sec className="pf-ls-sec pf-ls-edge" aria-labelledby="pf-ls-title">
        <div data-landing-copy className="pf-ls-copy">
          <h1 id="pf-ls-title">
            {HERO_LINES.map((line, i) => (
              <span className="pf-ls-line" key={line}>
                <span style={{ animationDelay: `${0.6 + i * 0.1}s` }}>{line}</span>
              </span>
            ))}
          </h1>
          <Link className="pf-ls-btn" href="/">
            시작하기
          </Link>
        </div>
      </section>

      <section data-landing-sec className="pf-ls-sec">
        <div data-landing-copy className="pf-ls-copy">
          <h2>
            <span id="pf-ls-count" className="pf-mono">
              468
            </span>
            개의 점으로
            <br />
            얼굴을 읽고
          </h2>
        </div>
      </section>

      <section data-landing-sec className="pf-ls-sec">
        <div data-landing-copy className="pf-ls-copy">
          <h2>
            형태를
            <br />
            맞춰서
          </h2>
        </div>
      </section>

      <section data-landing-sec className="pf-ls-sec">
        <div data-landing-copy className="pf-ls-copy">
          <h2>
            어느 각도에서든
            <br />
            나의 얼굴
          </h2>
        </div>
      </section>

      <section data-landing-sec className="pf-ls-sec pf-ls-tall">
        <div data-landing-copy className="pf-ls-copy">
          <h2>
            고민하던 변화를,
            <br />
            미리 내 얼굴에
          </h2>
        </div>
      </section>

      <section data-landing-sec className="pf-ls-sec pf-ls-edge">
        <div data-landing-copy className="pf-ls-copy">
          <h2>
            내 얼굴로,
            <br />
            먼저 보기.
          </h2>
          <Link className="pf-ls-btn" href="/">
            시작하기
          </Link>
        </div>
      </section>

      <p className="pf-ls-note">
        인물은 메타휴먼으로 만든 가상 인물이며, 미리보기는 참고용 시뮬레이션이라 실제 결과와 다를 수
        있어요.
      </p>
    </div>
  )
}
