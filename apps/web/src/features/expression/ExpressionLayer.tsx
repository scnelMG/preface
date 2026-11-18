'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three'
import type { EyeRig } from '@/features/viewer/eyeRig'
import { expressionBus } from './bus'
import {
  addDisplacement,
  gazeMatrices,
  lidsOverEyeballs,
  lipsOnTeeth,
  refreshNormals,
  turnEyes,
  turnHead,
} from './deform'
import { createEyeRigSkin } from './eyeRigSkin'
import { createMirror } from './mirror'
import { displacement, type ExpressionRig } from './rig'
import { distance, overlayPart, prepareScene, type Part, type Scene } from './scene'
import type { ExpressionFrame } from './tracker'
import { installWrinkles } from './wrinkles'

/**
 * After 모델에 표정 한 프레임을 얹는다(정점 위치를 직접 쓴다).
 *
 * - 표정 변위·시선·머리 회전은 다른 편집이 만든 위치(`base`) 위에 더한다. 그 위치는 `skinBase`로 **값을 받아** 쓴다.
 *   화면의 형상에서 읽어 오면 안 된다: 읽는 순간 그 형상에는 직전 표정 프레임(머리 회전 포함)이 들어 있을 수 있어,
 *   그 값이 기준으로 굳고 다음 프레임이 한 번 더 돌린다(2026-11-12: 슬라이더를 움직이면 피부만 더 돌아 눈알이 어긋남).
 * - 변위의 합에는 "부드러운 살이 단단한 것 위에 얹혀 있다"는 사실이 없다. 그래서 두 가지 접촉을 지킨다:
 *   눈꺼풀은 눈알 표면을 타고 넘고, 입술은 치아 안으로 들어가지 않는다.
 * - 윤곽·체형은 GLB에 구운 morph target이라 GPU에서 따로 더해진다. 여기서 건드리지 않는다.
 * - Before 모델과 형상을 나눠 쓰지 않도록 After 쪽 형상을 한 번 복제한다.
 * - 눈 편집이 열린 모델은 피부가 세분화돼 있다. 그 피부는 눈 리그를 거쳐 그린다(`Part.viaEyeRig`).
 */
export function ExpressionLayer({
  after,
  rig,
  skinBase: initialSkin,
  eyeRig,
  original,
  active = true,
  edited = true,
}: {
  /** 지금 화면에 그려지는 모델인가. 아니면 프레임만 기억해 두고, 다시 보일 때 그리기 전에 얹는다 */
  active?: boolean
  /** 편집이 들어가는 모델인가. 원본 보기용 모델(false)은 다른 편집의 피부 위치를 받지 않는다 */
  edited?: boolean
  after: Object3D
  rig: ExpressionRig
  /** 눈 편집이 열린 모델의 눈 리그(피부가 세분화돼 있다). 없으면 피부 형상에 직접 쓴다 */
  eyeRig: EyeRig | null
  /** 불러온 원본 장면(세분화 전 피부의 정점·템플릿 번호를 읽는다) */
  original: Object3D
  /** 다른 편집(코 등)이 만든 피부 위치. 없으면 GLB의 위치 그대로. 바뀔 때마다 뷰어가 `expressionBus.rebase`도 부른다 */
  skinBase: Float32Array | null
}) {
  const invalidate = useThree((s) => s.invalidate)
  const scene = useRef<Scene | null>(null)
  const frame = useRef<ExpressionFrame | null>(null)
  const shown = useRef(active)
  const stale = useRef(false)
  const reapply = useRef<(() => void) | null>(null)
  // 모델을 준비할 때의 시작 위치. 그 뒤 바뀌는 값은 뷰어가 `expressionBus.rebase`로 바로 알려 준다
  const skinBase = useRef(initialSkin)
  useEffect(() => {
    skinBase.current = initialSkin
  }, [initialSkin])

  useEffect(() => {
    const current = prepareScene(after, rig, eyeRig, original)
    const wrinkles = current.skin ? installWrinkles(current.skin.mesh, rig) : null
    const mirror = createMirror(rig)
    const drawEyeRigSkin = eyeRig ? createEyeRigSkin(eyeRig) : null
    scene.current = current
    const buffer = new Float32Array(rig.nbase * 3)
    let hair: { object: Object3D; rest: Matrix4 } | null = null
    let paint: Part | null = null

    /** 헤어의 두피 칠(있으면): 피부와 같은 정점이라 같은 표정·고개 회전을 얹는다 */
    function scalpPaint() {
      const found = after.getObjectByName('scalp-paint')
      const mesh = found instanceof Mesh ? found : null
      if (paint?.mesh === mesh) return paint
      // 헤어를 벗겼거나 바꿨다: 복제해 둔 형상을 놓는다
      paint?.mesh.geometry.dispose()
      paint = mesh ? overlayPart(mesh) : null
      return paint
    }

    /** 헤어는 두피(머리 가중치 1)에 붙어 있으므로 머리와 같은 회전을 통째로 준다 */
    function turnHair(next: ExpressionFrame | null) {
      const object = after.getObjectByName('hair')
      if (object && hair?.object !== object) hair = { object, rest: object.matrix.clone() }
      if (!hair || !rig.head) return
      const p = new Vector3(...rig.head.pivot)
      const rotate = next
        ? new Matrix4()
            .makeTranslation(p)
            .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...next.head)))
            .multiply(new Matrix4().makeTranslation(p.clone().negate()))
        : new Matrix4()
      rotate
        .multiply(hair.rest)
        .decompose(hair.object.position, hair.object.quaternion, hair.object.scale)
    }

    function apply(incoming: ExpressionFrame | null) {
      frame.current = incoming
      // 웹캠 미리보기가 거울처럼 보이므로 모델도 거울처럼 움직인다(만두 11/14: 좌우가 반대로 보였다)
      const flip = mirror.available
      const next = incoming && flip ? mirror.frame(incoming) : incoming
      // 안 보이는 모델은 계산하지 않는다(원본 보기로 바뀌는 순간 최신 프레임을 얹는다)
      if (!shown.current) {
        stale.current = true
        return
      }
      stale.current = false
      wrinkles?.set(next?.wrinkle?.[0] ?? 0, next?.wrinkle?.[1] ?? 0, next?.wrinkle?.[2] ?? 0)
      const field = next ? displacement(rig, next.weights, buffer) : null
      const moved = field && flip ? mirror.field(field) : field
      const eyes = next?.gaze && rig.eyes ? gazeMatrices(rig, next.gaze) : null
      const head =
        next && rig.head
          ? new Matrix4().makeRotationFromQuaternion(new Quaternion(...next.head)).elements
          : null
      const overlay = scalpPaint()
      for (const part of overlay ? [...current.parts, overlay] : current.parts) {
        const out =
          part.viaEyeRig?.scratch ??
          (part.mesh.geometry.getAttribute('position').array as Float32Array)
        addDisplacement(part, out, moved)
        if (moved && part === current.skin) {
          lidsOverEyeballs(current, rig.axes.fwd, out, part.base)
          if (rig.contact) lipsOnTeeth(current, rig.contact, out, moved)
        }
        if (eyes && current.eyeCenters) turnEyes(part, out, eyes, current.eyeCenters)
        if (head && rig.head) turnHead(part, out, head, rig.head)
        if (part.viaEyeRig && drawEyeRigSkin) drawEyeRigSkin(part, out)
        else refreshNormals(part)
      }
      turnHair(next)
      invalidate()
    }

    function rebase(skinPositions: Float32Array | null) {
      const skin = current.skin
      if (skin && skinPositions && skinPositions.length === skin.base.length) {
        skin.base.set(skinPositions)
        for (const eyeball of current.eyeballs)
          eyeball.lids.forEach((i, j) => {
            eyeball.rest[j] = distance(skin.base, i, eyeball.center)
          })
      }
      apply(frame.current)
    }
    // 이 모델이 만들어질 때 이미 다른 편집이 들어가 있으면 그 위치에서 시작한다
    rebase(skinBase.current)
    // 원본 보기용 모델은 다른 편집이 쓴 피부 위치를 받지 않는다
    const detach = expressionBus.attach({ apply, rebase: (skin) => void (edited && rebase(skin)) })
    reapply.current = () => {
      if (stale.current) apply(frame.current)
    }
    if (edited && process.env.NODE_ENV === 'development')
      // 개발 서버에서 웹캠 없이 확인할 때 쓴다(콘솔에서 프레임을 넣고 정점을 읽는다)
      (window as unknown as { __expression?: unknown }).__expression = {
        rig,
        scene: current,
        apply,
        emit: expressionBus.emit,
        eyeRig,
      }
    invalidate()
    return () => {
      // 이 모델에 얹은 표정을 걷어 낸 뒤 놓는다(모델이 다시 만들어질 때 변형된 값이 남지 않게)
      detach()
      reapply.current = null
      const last = frame.current
      const was = shown.current
      shown.current = true
      apply(null)
      // 모델이 다시 만들어져도 새 레이어가 같은 표정에서 이어 간다
      shown.current = was
      frame.current = last
      scene.current = null
    }
  }, [after, rig, eyeRig, original, edited, invalidate])

  // 보이는 모델이 바뀌면 그리기 전에 최신 표정을 얹는다: 원본 보기를 눌러도 표정은 그대로고 편집값만 빠진다
  useLayoutEffect(() => {
    shown.current = active
    if (active) reapply.current?.()
  }, [active])

  return null
}
