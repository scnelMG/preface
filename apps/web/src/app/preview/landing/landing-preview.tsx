'use client'

import Link from 'next/link'
import { ArrowRightIcon, ArrowDownIcon } from '@phosphor-icons/react'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { DEFAULT_LIGHTING } from '@/features/viewer/lighting'
import { PreviewNav } from '../preview-nav'
import { PreviewLogin } from '../preview-login'

const view = { preset: 'threeQuarter' as const, nonce: 0 }
const weights = { 'nose.tip_projection': 0.2 }

export function LandingPreview() {
  return (
    <main className="preface-preview pf-flow pf-landing">
      <PreviewNav member={false} />
      <section className="pf-landing-hero" aria-labelledby="pf-landing-title">
        <div className="pf-landing-copy">
          <h1 id="pf-landing-title">
            내 얼굴을,
            <br />
            <span>나의 시선으로.</span>
          </h1>
          <p>
            얼굴을 입체적으로 살펴보고,
            <br />
            원하는 변화를 직접 조절해 보세요.
          </p>
          <div className="pf-hero-actions">
            <Link className="pf-primary" href="/preview/new">
              내 모델 만들기 <ArrowRightIcon size={18} />
            </Link>
            <Link className="pf-text-link" href="/preview">
              먼저 체험하기
            </Link>
          </div>
        </div>
        <div className="pf-landing-model" role="img" aria-label="여성 기본 모델의 3D 미리보기">
          <FaceViewer
            meshUrl={SAMPLE_HEADS[1].meshUrl}
            weights={weights}
            view={view}
            showing="after"
            layout="single"
            lighting={DEFAULT_LIGHTING}
          />
        </div>
        <p className="pf-landing-caption">기본 모델 미리보기</p>
        <a className="pf-landing-scroll" href="#pf-how-it-works">
          어떻게 시작하나요? <ArrowDownIcon size={15} />
        </a>
      </section>
      <section className="pf-how" id="pf-how-it-works" aria-label="이용 방법">
        <div>
          <h2>여러 각도로 담고.</h2>
          <p>
            휴대폰으로 얼굴을 촬영해
            <br />
            나만의 3D 모델을 만드세요.
          </p>
        </div>
        <div>
          <h2>작은 변화부터 조절하고.</h2>
          <p>
            코의 형태를 조절하며
            <br />
            여러 각도에서 살펴보세요.
          </p>
        </div>
        <div>
          <h2>원본과 나란히.</h2>
          <p>
            같은 각도에서 변경 전후를 비교하고,
            <br />
            마음에 드는 시안을 모아보세요.
          </p>
        </div>
        <Link className="pf-primary" href="/preview/new">
          내 얼굴에서 시작하기 <ArrowRightIcon size={18} />
        </Link>
      </section>
      <footer className="pf-footer">
        <span>preface°</span>
        <p>가능성을 살펴보는 참고용 시뮬레이션</p>
        <Link href="/preview">기본 모델 체험</Link>
      </footer>
      <PreviewLogin />
    </main>
  )
}
