'use client'

import { Component, Suspense, useEffect, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { useTheme } from '@/shared/theme/theme'
import { Backdrop } from './Backdrop'
import { Face } from './Face'
import { away, ease, measure, ramp, resetScroll, scroll } from './scroll'

/**
 * 랜딩 무대(landing-r3f App.jsx의 무대 부분을 옮김, 2026-10-31). 페이지 뒤에 고정된 층들:
 * 배경 캔버스 < 거대 글자 pre·face < 3D 머리 캔버스 < 왼쪽 막·바닥 그라데이션 < (페이지 문구).
 *
 * - 문구는 LandingPage가 일반 HTML로 그린다(서버 그림·읽기 프로그램·WebGL이 없어도 읽힌다). 이 컴포넌트는
 *   `[data-landing-copy]` 블록의 깊이감(천천히 따라옴)·흐림만 매 프레임 바꾼다.
 * - 스크롤은 가로채지 않는다(원본의 Lenis는 쓰지 않음). 동작 줄이기면 문구 이동·흐림 없이 투명도만.
 * - 문구는 바로 보이고, 머리는 받는 대로 스캔되며 나타난다. 화면을 덮던 불러오기 숫자(000→100)는 없앴다(-784).
 *   머리 파일을 못 받으면 Face가 다시 받고, 끝내 못 받거나 WebGL이 안 되면 무대 없이 문구만 남는다.
 */
const SECTION_COUNT = 6
const PREVIEW_INDEX = 4

export function LandingStage() {
  const light = useTheme() === 'light'

  useEffect(() => {
    resetScroll()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const byId = (id: string) => document.getElementById(id)
    const onPointer = (event: PointerEvent) => {
      scroll.mx = event.clientX
      scroll.my = event.clientY
    }
    window.addEventListener('pointermove', onPointer)

    let raf = 0
    const tick = () => {
      const sf = measure()
      const W = innerWidth
      const H = innerHeight
      const desktop = W >= 820
      document.querySelectorAll<HTMLElement>('[data-landing-copy]').forEach((el, i) => {
        const tall = i === PREVIEW_INDEX
        // 깊이: 문구가 페이지보다 천천히 따라와 3D 무대 앞의 층처럼 읽힌다(첫 화면은 가운데에 머문다)
        const drift = i === 0 ? Math.max(sf, 0.5) - 0.5 : sf - (i + 0.5)
        el.style.transform =
          !tall && desktop && !reduce ? `translate3d(0, ${drift * 0.16 * H}px, 0)` : ''
        if (i === 0 && sf < 0.6) {
          el.style.opacity = '1'
          el.style.filter = 'none'
          return
        }
        // 마지막 구간은 닿으면 또렷하게 남는다(페이지가 가운데보다 먼저 끝날 수 있다)
        const last = i === SECTION_COUNT - 1
        const d = last ? Math.max(0, i + 0.5 - sf - 0.25) : Math.abs(sf - (i + 0.5))
        const edge = i === 0 || last
        const v = tall
          ? 1 - ramp(d, 0.55, 0.85)
          : edge
            ? 1 - ramp(d, 0.12, 0.38)
            : 1 - ramp(d, 0.3, 0.68)
        el.style.opacity = String(v)
        el.style.filter = reduce ? 'none' : `blur(${(1 - v) * 8}px)`
      })

      const off = away(sf)
      const veil = byId('pf-ls-veil')
      if (veil) veil.style.opacity = String(desktop ? off : 1)

      // 거대 글자 pre · face: 머리 양옆으로 갈라 깔고, 머리가 비켜나면 같이 물러난다(데스크톱만)
      const head = scroll.head
      const pre = byId('pf-ls-pre')
      const face = byId('pf-ls-face')
      if (head && desktop && pre && face) {
        const size = parseFloat(getComputedStyle(pre).fontSize)
        const gap = 0.15 * H * head.s + off * W * 0.3
        pre.style.transform = `translate3d(${head.x - gap - pre.offsetWidth}px, ${head.y - size * 0.62}px, 0)`
        face.style.transform = `translate3d(${head.x + gap}px, ${head.y - size * 0.62}px, 0)`
        const opacity = String(ease(ramp(scroll.intro ?? 0, 0.2, 0.9)) * (1 - off))
        pre.style.opacity = opacity
        face.style.opacity = opacity
      }
      const count = byId('pf-ls-count')
      if (count) count.textContent = String(Math.round(468 * ease(ramp(sf, 0.8, 1.45))))

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      resetScroll()
    }
  }, [])

  return (
    <div className="pf-ls-stage" aria-hidden="true">
      <Canvas className="pf-ls-bg" dpr={1} gl={{ antialias: false }}>
        <Backdrop light={light} />
      </Canvas>

      <div className="pf-ls-giant">
        <span id="pf-ls-pre" className="pf-ls-pre">
          pre
        </span>
        <span id="pf-ls-face" className="pf-ls-face">
          face
        </span>
      </div>

      <StageBoundary>
        <Canvas
          className="pf-ls-head"
          camera={{ fov: 22, near: 0.01, far: 50, position: [0, 0.02, 1] }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, toneMapping: ACESFilmicToneMapping }}
        >
          <hemisphereLight args={[0xffffff, light ? 0xcfcbc4 : 0x222226, light ? 0.8 : 0.35]} />
          <directionalLight position={[-1.2, 1.0, 1.6]} intensity={2.2} color={0xfff3e6} />
          <directionalLight
            position={[1.4, 0.8, -1.2]}
            intensity={light ? 1.2 : 2.4}
            color={0xdfe6ff}
          />
          <directionalLight
            position={[-1.4, 0.6, -1.0]}
            intensity={light ? 0.7 : 1.4}
            color={0xdfe6ff}
          />
          <Suspense fallback={null}>
            <Face light={light} />
          </Suspense>
        </Canvas>
      </StageBoundary>

      <div id="pf-ls-veil" className="pf-ls-veil" />
      <div className="pf-ls-floor" />
    </div>
  )
}

/** 머리 파일을 못 읽거나 WebGL이 안 되면 무대만 비우고 문구는 남긴다 */
class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
