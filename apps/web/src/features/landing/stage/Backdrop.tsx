'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, ShaderMaterial, Vector2 } from 'three'
import { scroll } from './scroll'

/**
 * 어두운 흐름 배경 + 필름 결 + 머리를 따라가는 보라 빛(landing-r3f Backdrop.jsx를 옮김).
 * 따로 된 캔버스 한 장이고 해상도는 1배로 둔다. 밝은 화면에서는 바탕색과 빛 세기만 바꾼다.
 */
export function Backdrop({ light }: { light: boolean }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uScroll: { value: 0 },
          uAspect: { value: 1 },
          uHead: { value: new Vector2(0.2, 0) },
          uBase: { value: new Color(0.043, 0.043, 0.051) },
          uGlow: { value: 0.85 },
          uGrain: { value: 0.035 },
        },
        vertexShader:
          'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform float uTime; uniform float uScroll; uniform float uAspect; uniform vec2 uHead;
          uniform vec3 uBase; uniform float uGlow; uniform float uGrain; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
          float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
          void main(){
            vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
            float t = uTime * 0.03 + uScroll * 0.08;
            float f = fbm(p * 1.6 + vec2(t, -t * 0.7) + fbm(p * 2.2 - t));
            float glow = smoothstep(0.75, 0.0, length(p - uHead - vec2(0.0, 0.05))) * (0.55 + 0.45 * f);
            vec3 col = uBase + vec3(0.11, 0.08, 0.22) * glow * uGlow + vec3(0.03) * (f - 0.5);
            col += (h(vUv * 800.0 + fract(uTime)) - 0.5) * uGrain;
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  )
  // 매 프레임 값은 ref로 받은 재질에 쓴다(렌더 중 만든 값을 직접 바꾸지 않는다, react-hooks/immutability)
  const live = useRef<ShaderMaterial>(null)
  useFrame((state) => {
    if (!live.current) return
    const u = live.current.uniforms
    u.uTime.value = state.clock.elapsedTime
    u.uScroll.value = scroll.sf
    u.uAspect.value = state.size.width / state.size.height
    // 밝은 화면: 개발 서버 바탕색(#f3f3f6, --pf-canvas)으로, 빛은 옅게 더한다
    ;(u.uBase.value as Color).setRGB(
      light ? 0.953 : 0.043,
      light ? 0.953 : 0.043,
      light ? 0.965 : 0.051,
    )
    u.uGlow.value = light ? 0.32 : 0.85
    u.uGrain.value = light ? 0.022 : 0.035
    const head = scroll.head
    if (head) {
      ;(u.uHead.value as Vector2).set(
        (head.x / state.size.width - 0.5) * u.uAspect.value,
        0.5 - head.y / state.size.height,
      )
    }
  })
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive ref={live} object={material} attach="material" />
    </mesh>
  )
}
