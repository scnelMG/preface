'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  type Group,
  type Material,
  MathUtils,
  type Mesh,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { away, clamp, ease, ramp, scroll, track } from './scroll'
import { RetryBoundary, withRetry } from './retry'

/**
 * 랜딩 머리 장면(landing-r3f Face.jsx를 옮김, 2026-10-31).
 *
 * 메타휴먼 머리와 그 위 468개 랜드마크. 스크롤 하나로 카메라·스캔·회색 형상·피부·코 변형이 이어진다.
 * 메타휴먼은 홍보물 전용 예외를 로컬 시안에 임시로 넓혀 쓴다(features/home/heroHead.ts와 같은 조건).
 * 파일(`public/metahuman/`)은 저장소에 넣지 않는다.
 */
const GLB = '/metahuman/head.glb'
const GLB_LM = '/metahuman/landmarks.json'

const MOBILE_LIFT = 0.2 // 휴대폰: 아래에 붙는 문구를 피해 머리를 화면 높이의 이만큼 위로
const FRAME = 1.3 // 카메라 거리 단위: 머리카락·목이 들어갈 여유
const CLAY = 0.46 // 피부색이 들어오기 전 회색 형상의 밝기

// 구간마다 열쇠 값(도 · 머리 거리 · 얼굴 쪽으로 당기는 정도). 첫 화면 45° → 점 속으로 → 회색 형상 위로 →
// 물러나며 한 바퀴 돌아 옆모습 → 코로 다가감 → 첫 화면 시점으로
const AZ = track([
  [0, -24],
  [1.15, -24],
  [1.7, -34],
  [2.4, 14],
  [3.05, -4],
  [4.15, 296],
  [4.9, 294],
  [5.4, 336],
  [7, 336],
])
const DIST = track([
  [0, 1.0],
  [1.15, 1.0],
  [1.65, 0.66],
  [2.0, 0.74],
  [2.4, 0.9],
  [3.05, 1.0],
  [3.6, 1.2],
  [4.15, 0.46],
  [4.9, 0.44],
  [5.4, 1.0],
  [7, 1.0],
])
const EL = track([
  [0, 0],
  [1.15, 0],
  [1.65, -9],
  [2.4, 12],
  [3.05, 3],
  [3.6, 10],
  [4.15, 0],
  [7, 0],
])
const ROLL = track([
  [0, 0],
  [1.15, 0],
  [1.65, -3],
  [2.4, 2.5],
  [3.0, 0],
  [7, 0],
])
const LOOK = track([
  [0, 0],
  [3.9, 0],
  [4.15, 0.08],
  [4.9, 0.08],
  [5.35, 0],
  [7, 0],
])

const NOISE = `
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
`

interface Landmarks {
  landmarks: [number, number, number][]
  centre: [number, number, number]
}
interface Uniforms {
  reveal: { value: Vector2 }
  range: { value: Vector2 }
  clay: { value: number }
  /** 잘린 목이 녹아드는 색 = 무대 바탕색(밝은 화면에서는 미색) */
  fade: { value: Color }
}

/**
 * `progress`를 주면 스크롤 대신 그 값(같은 sf 눈금)으로 장면을 맞추고, 카메라는 천천히 좌우로 흔들린다.
 * 3D 생성 대기 화면이 서버 단계(점 → 회색 형상 → 피부)를 보여 줄 때 쓴다(features/reconstruction/waiting/BuildStage).
 * 이때는 랜딩의 전역 스크롤 값(scroll)을 건드리지 않는다.
 * `bald`를 주면 머리카락 카드(Hair)를 숨긴다. 생성 대기 화면은 민머리로 보여 준다(서비스 결과물도 머리카락이 없다).
 */
export function Face({
  light = false,
  progress,
  bald = false,
}: {
  light?: boolean
  progress?: number
  bald?: boolean
}) {
  const [lm, setLm] = useState<Landmarks | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    // 일시적으로 못 받아도 다시 받는다(-784). 끝내 못 받으면 무대만 빈다
    withRetry(async () => {
      const response = await fetch(GLB_LM, { signal: controller.signal })
      if (!response.ok) throw new Error(`landmarks ${response.status}`)
      return (await response.json()) as Landmarks
    }, controller.signal)
      .then(setLm)
      .catch(() => {})
    return () => controller.abort()
  }, [])
  // 머리 GLB를 못 받으면 useGLTF가 보관한 실패를 지우고 다시 받는다. 지우지 않으면 새로고침 전까지
  // 이 탭의 랜딩·대기 화면 모두 같은 실패를 돌려받아 머리가 비었다(-784)
  return lm ? (
    <RetryBoundary onError={() => useGLTF.clear(GLB)}>
      <Head lm={lm} light={light} progress={progress} bald={bald} />
    </RetryBoundary>
  ) : null
}

/** 위에서 아래로 훑는 스캔: 두 높이 사이에서만 피부가 보이고 경계마다 가는 빛 선. uClay는 회색 형상으로 바꾼다 */
function addDissolve(
  material: Material,
  u: Uniforms,
  { yTop, ySpan, yCut }: { yTop: number; ySpan: number; yCut: number },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = u.reveal
    shader.uniforms.uClay = u.clay
    shader.uniforms.uFade = u.fade
    shader.vertexShader =
      'varying vec3 vW;\n' +
      shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader =
      'uniform vec2 uReveal; uniform float uClay; uniform vec3 uFade; varying vec3 vW;\n' +
      NOISE +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${CLAY}), uClay);`,
        )
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           float y = (${yTop.toFixed(4)} - vW.y) / ${ySpan.toFixed(4)};
           vec2 th = uReveal * 1.1 - 0.05;
           if (y < th.x || y > th.y) discard;
           if (vW.y < ${yCut.toFixed(4)} + (n3(vW * 45.0) - 0.5) * 0.03) discard;
           gl_FragColor.rgb = mix(uFade, gl_FragColor.rgb, smoothstep(${yCut.toFixed(4)}, ${(yCut + ySpan * 0.22).toFixed(4)}, vW.y));
           float line = max(smoothstep(th.y - 0.006, th.y, y), 1.0 - smoothstep(th.x, th.x + 0.006, y));
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.92), line * 0.7);`,
        )
  }
  material.needsUpdate = true
}

/** 468개 랜드마크: 피부가 걷힌 '읽기'와 회색 형상이 덮는 '맞추기' 사이에, 아직 면이 없는 곳에만 보인다 */
function useLandmarks(points: Landmarks['landmarks'], u: Uniforms) {
  return useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(points.flat()), 3))
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSize: { value: 3 },
        uAlpha: { value: 0 },
        uPx: { value: 1 },
        uColor: { value: new Color(0.97, 0.96, 1.0) },
        uReveal: u.reveal,
        uRange: u.range,
      },
      vertexShader:
        'uniform float uSize; uniform float uPx; varying float vY;\n' +
        'void main(){ vY = (modelMatrix * vec4(position,1.0)).y; vec4 mv = modelViewMatrix * vec4(position,1.0);' +
        ' gl_Position = projectionMatrix * mv; gl_PointSize = uSize * uPx / -mv.z; }',
      fragmentShader: `
        uniform float uAlpha; uniform vec2 uReveal; uniform vec2 uRange; uniform vec3 uColor; varying float vY;
        void main(){
          float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
          float y = (uRange.x - vY) / uRange.y; vec2 th = uReveal * 1.1 - 0.05;
          if (y >= th.x && y <= th.y) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.15, d) * uAlpha);
        }`,
    })
    const cloud = new Points(geometry, material)
    const update = (sf: number, bufferHeight: number, light: boolean) => {
      material.uniforms.uAlpha.value = ramp(sf, 0.7, 1.0) * (1 - ramp(sf, 2.5, 2.7))
      material.uniforms.uPx.value = bufferHeight / 900
      if (light) (material.uniforms.uColor.value as Color).setRGB(0.12, 0.11, 0.16)
      else (material.uniforms.uColor.value as Color).setRGB(0.97, 0.96, 1.0)
    }
    return { cloud, update }
  }, [points, u])
}

/** 미리보기: 서비스 슬라이더 단위로 콧대를 40%까지 올렸다가 되돌린다(10/31 만두: 100%는 과함) */
const BRIDGE = 0.4
function previewBridge(sf: number) {
  const bridge = BRIDGE * ease(ramp(sf, 4.2, 4.7)) * (1 - ease(ramp(sf, 4.95, 5.3)))
  scroll.bridge = bridge
  return bridge
}

/** 첫 화면에 피부가 스캔되어 나타나고, '읽기'에서 점으로 걷히고, '맞추기'에서 회색 형상이 덮고, '완성'에서 색이 든다 */
const reveal = (sf: number, intro: number): [number, number] =>
  sf < 1.8 ? [ease(ramp(sf, 0.75, 1.15)), intro] : [0, ease(ramp(sf, 2.0, 2.6))]
const clay = (sf: number) => (sf < 1.8 ? 0 : 1 - ease(ramp(sf, 2.9, 3.3)))
const between01 = (sf: number) => ease(ramp(sf, 0.4, 0.8)) * (1 - ease(ramp(sf, 5.1, 5.4)))

function Head({
  lm,
  light,
  progress,
  bald,
}: {
  lm: Landmarks
  light: boolean
  progress?: number
  bald: boolean
}) {
  const { camera, size, gl } = useThree()
  const { scene } = useGLTF(GLB)
  const centre = useMemo(() => new Vector3(...lm.centre), [lm])
  const u = useMemo<Uniforms>(
    () => ({
      reveal: { value: new Vector2(0, 0) },
      range: { value: new Vector2(1, 1) },
      clay: { value: 0 },
      fade: { value: new Color() },
    }),
    [],
  )
  const marks = useLandmarks(lm.landmarks, u)
  const tilt = useRef<Group>(null)
  const start = useRef(0)
  // 단계 구동: 서버 단계가 바뀌면 장면이 그 값으로 천천히 옮겨 간다(뚝 끊기지 않게)
  const shown = useRef(progress ?? 0)
  // 빠르게 스크롤하면 시점이 몇 도 흔들리는 관성
  const inertia = useRef<{ last: { sf: number; t: number } | null; vel: number }>({
    last: null,
    vel: 0,
  })

  const morph = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const ySpan = box.max.y - box.min.y
    const cut = { yTop: box.max.y - centre.y, ySpan, yCut: box.min.y - centre.y + ySpan * 0.08 }
    u.range.value.set(cut.yTop, ySpan)
    const meshes: Mesh[] = []
    scene.traverse((object) => {
      if ((object as Mesh).isMesh) meshes.push(object as Mesh)
    })
    let found: Mesh | null = null
    for (const mesh of meshes) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material) => {
        // 머리카락·눈썹 카드는 알파 마스크: 캔버스 MSAA 커버리지로 가장자리를 부드럽게
        if (material.alphaTest > 0) material.alphaToCoverage = true
        addDissolve(material, u, cut)
      })
      const dict = mesh.morphTargetDictionary
      if (dict && Object.keys(dict).some((k) => k.includes('bridge'))) found = mesh
    }
    return found
  }, [scene, centre, u])
  // 불러온 장면은 랜딩과 대기 화면이 함께 쓴다(useGLTF 캐시). 그래서 매번 이 화면 값으로 다시 맞춘다
  useEffect(() => {
    scene.traverse((object) => {
      if (object.name === 'Hair') object.visible = !bald
    })
  }, [scene, bald])
  // 매 프레임 값은 ref를 거쳐 쓴다(렌더 중 만든 값을 직접 바꾸지 않는다, react-hooks/immutability)
  const live = useRef({ u, morph })
  useEffect(() => {
    live.current = { u, morph }
  }, [u, morph])

  useFrame((state) => {
    const driven = progress !== undefined
    const now = performance.now() / 1000
    const { width: W, height: H } = size
    let sf: number
    let intro: number
    if (driven) {
      shown.current += (progress - shown.current) * 0.035
      sf = shown.current
      intro = 1
      swayCamera(camera, state.clock.elapsedTime)
    } else {
      sf = scroll.sf
      if (!start.current) start.current = now + 0.7
      intro = scroll.intro = ease(clamp((now - start.current) / 1.8, 0, 1))
      rigCamera(camera, size, sf, inertia.current)
    }

    // 랜딩 가운데 시점에서는 머리가 커서 쪽으로 살짝 돌아본다
    if (tilt.current && !driven) {
      const look = 1 - between01(sf)
      const ry = scroll.mx === undefined ? 0 : (scroll.mx / W - 0.5) * 0.35 * look
      const rx = scroll.my === undefined ? 0 : (scroll.my / H - 0.5) * 0.14 * look
      tilt.current.rotation.y += (ry - tilt.current.rotation.y) * 0.05
      tilt.current.rotation.x += (rx - tilt.current.rotation.x) * 0.05
    }

    marks.update(sf, H * gl.getPixelRatio(), light)
    const { u: uniforms, morph: target } = live.current
    uniforms.reveal.value.set(...reveal(sf, intro))
    uniforms.clay.value = clay(sf)
    // 무대 바탕색(#0b0b0d / 밝은 화면 #f3f3f6 = --pf-canvas). 섞는 자리(dithering 뒤)는 이미 화면 색 공간이라 sRGB 값을 그대로 넣는다
    if (light) uniforms.fade.value.setRGB(0.953, 0.953, 0.965)
    else uniforms.fade.value.setRGB(0.043, 0.043, 0.051)
    const bridge = driven ? 0 : previewBridge(sf)
    if (target?.morphTargetDictionary && target.morphTargetInfluences) {
      const dict = target.morphTargetDictionary
      const key = Object.keys(dict).find((k) => k.includes('bridge'))
      if (key !== undefined) target.morphTargetInfluences[dict[key]] = bridge
    }
  })

  return (
    <group ref={tilt}>
      <group position={[-centre.x, -centre.y, -centre.z]}>
        <primitive object={scene} />
        <primitive object={marks.cloud} />
      </group>
    </group>
  )
}

/** 단계 구동 카메라: 45° 근처에서 좌우로 천천히 흔들려 형상의 입체가 읽힌다(사용자 조작 없음) */
function swayCamera(camera: Camera, t: number) {
  const az = MathUtils.degToRad(-20 + Math.sin(t * 0.22) * 32)
  const el = MathUtils.degToRad(4 + Math.sin(t * 0.13) * 3)
  const dist = FRAME * 1.02
  camera.position.set(
    Math.sin(az) * Math.cos(el) * dist,
    0.02 + Math.sin(el) * dist,
    Math.cos(az) * Math.cos(el) * dist,
  )
  camera.lookAt(0, 0, 0)
}

/** 페이지 전체에 하나뿐인 카메라. 머리가 화면 어디에 있는지(scroll.head)도 내보낸다(거대 글자가 따라간다) */
function rigCamera(
  camera: Camera,
  size: { width: number; height: number },
  sf: number,
  inertia: { last: { sf: number; t: number } | null; vel: number },
) {
  const now = performance.now()
  if (inertia.last) {
    const dt = Math.max(0.008, (now - inertia.last.t) / 1000)
    inertia.vel += ((sf - inertia.last.sf) / dt - inertia.vel) * 0.12
  }
  inertia.last = { sf, t: now }
  const { width: W, height: H } = size
  const mobile = W < 820
  const off = away(sf)
  // 첫·끝 화면은 고정. 관성과 세로 화면 물러남은 그 사이에서만
  const between = ease(ramp(sf, 1.2, 1.7)) * (1 - ease(ramp(sf, 5.0, 5.4)))
  const swing = MathUtils.clamp(inertia.vel * 9, -9, 9) * between
  const az = MathUtils.degToRad(AZ(sf) + swing)
  const el = MathUtils.degToRad(EL(sf) - swing * 0.25)
  const dist = FRAME * DIST(sf) * (mobile ? 1.0 + 0.55 * ramp(H / W, 1.2, 2.2) * between : 1)
  const look = LOOK(sf)
  camera.position.set(
    Math.sin(az) * Math.cos(el) * dist,
    0.02 + Math.sin(el) * dist,
    look + Math.cos(az) * Math.cos(el) * dist,
  )
  camera.lookAt(0, 0, look)
  camera.rotateZ(MathUtils.degToRad(ROLL(sf)))
  // 데스크톱: 첫·끝 화면은 가운데, 사이에서는 문구가 왼쪽을 읽는 동안 오른쪽 1/3로 비켜 선다
  ;(camera as PerspectiveCamera).setViewOffset(
    W,
    H,
    mobile ? 0 : -W * 0.2 * off,
    mobile ? H * MOBILE_LIFT : 0,
    W,
    H,
  )
  scroll.head = {
    x: mobile ? W / 2 : W * (0.5 + 0.2 * off),
    y: mobile ? H * (0.5 - MOBILE_LIFT) : H / 2,
    s: FRAME / dist,
  }
}
