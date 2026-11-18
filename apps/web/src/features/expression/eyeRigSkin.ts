/**
 * 눈 편집이 열린 모델의 피부 그리기. 화면의 피부는 눈 리그가 세분화한 형상(7만 정점)이라, 원래 해상도에서 계산한
 * 표정(위치·법선 차이)을 눈 리그의 대응으로 세분화 정점에 옮겨 눈 변형과 합쳐 그린다.
 */
import { setEyeBaseOffset, type EyeRig } from '@/features/viewer/eyeRig'
import { transferRefined } from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import { distance, templateNormals, type Part } from './scene'

type Refined = EyeRig['skins'][number]

/** 눈 틈이 무표정의 이 비율 아래면 쌍꺼풀이 다 펴지고, 위 비율부터는 다 접힌다 */
const FOLD_OPEN = [0.2, 0.9]

export function createEyeRigSkin(eyeRig: EyeRig) {
  /**
   * 표정이 없을 때 눈 리그가 그리는 법선(저장된 법선, 눈 변형 중이면 눈 리그의 음영). 눈 변형 결과가 바뀌면 다시 읽는다.
   * 눈 리그에 "차이 없음"으로 한 번 그리게 해서 그 결과를 가져온다
   */
  const shownCache = new WeakMap<Float32Array, Float32Array>()
  function shownNormals(refined: Refined) {
    let cached = shownCache.get(refined.eye)
    if (!cached) {
      setEyeBaseOffset(eyeRig, refined.mesh, null)
      cached = Float32Array.from(refined.mesh.geometry.getAttribute('normal').array as Float32Array)
      shownCache.set(refined.eye, cached)
    }
    return cached
  }

  /** 접힘 변위가 있는 세분화 정점이 어느 눈 것인지(없으면 -1). 눈 변형 결과가 바뀔 때만 다시 만든다 */
  const sidesCache = new WeakMap<Float32Array, Int8Array>()
  function foldSides(refined: Refined, fold: Float32Array, lids: { center: number[] }[]) {
    let side = sidesCache.get(fold)
    if (!side) {
      const sides = new Int8Array(fold.length / 3).fill(-1)
      for (let i = 0; i < sides.length; i++) {
        if (fold[3 * i] === 0 && fold[3 * i + 1] === 0 && fold[3 * i + 2] === 0) continue
        let best = Infinity
        lids.forEach(({ center }, e) => {
          const d = distance(refined.base, i, center)
          if (d < best) {
            best = d
            sides[i] = e
          }
        })
      }
      side = sides
      sidesCache.set(fold, side)
    }
    return side
  }

  /** 원래 해상도에서 계산한 피부 위치(`out`, 고친다)를 세분화 피부에 그린다 */
  return function draw(part: Part, out: Float32Array) {
    const via = part.viaEyeRig
    if (!via) return
    const refined = eyeRig.skins.find((item) => item.mesh === part.mesh)
    let any = false
    for (let i = 0; i < out.length && !any; i++) any = out[i] !== via.rest[i]
    if (!any || !refined) {
      setEyeBaseOffset(eyeRig, part.mesh, null)
      return
    }
    // 원래 해상도에서 법선이 얼마나 바뀌었는지(지금 - GLB 원래 형상)를 구한 뒤 위치 차이와 함께 세분화 정점으로 옮긴다.
    // 세분화 형상(7만 정점)에서 법선을 다시 구하면 느리고(프레임당 58 ms), 눈 밑의 미세한 접힘이 그대로 드러난다
    templateNormals(out, via.index, part.template, via.normalNow)
    // 쌍꺼풀은 눈을 뜰 때 접히고 감으면 펴진다: 눈 틈이 좁아진 만큼 접힘 변위를 덜어 낸다(눈마다)
    const fold = refined.fold ? foldSides(refined, refined.fold, via.lids) : null
    const unfold = via.lids.map(({ upper, lower, gap }) => {
      const now = distance(out, upper, [out[3 * lower], out[3 * lower + 1], out[3 * lower + 2]])
      const t = Math.max(0, Math.min(1, (now / gap - FOLD_OPEN[0]) / (FOLD_OPEN[1] - FOLD_OPEN[0])))
      return 1 - t * t * (3 - 2 * t)
    })
    for (let i = 0; i < out.length; i++) {
      out[i] -= via.rest[i]
      via.normalNow[i] -= via.normalRest[i]
    }
    const shown = shownNormals(refined)
    refined.offset = transferRefined(refined.sources, out, 3)
    const turn = transferRefined(refined.sources, via.normalNow, 3)
    const geometry = part.mesh.geometry
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const target = position.array as Float32Array
    const n = normal.array as Float32Array
    for (let i = 0; i < target.length; i += 3) {
      target[i] = refined.eye[i] + refined.offset[i]
      target[i + 1] = refined.eye[i + 1] + refined.offset[i + 1]
      target[i + 2] = refined.eye[i + 2] + refined.offset[i + 2]
      let x = shown[i] + turn[i]
      let y = shown[i + 1] + turn[i + 1]
      let z = shown[i + 2] + turn[i + 2]
      const flat = fold && fold[i / 3] >= 0 ? unfold[fold[i / 3]] : 0
      if (flat > 0 && refined.fold) {
        target[i] -= flat * refined.fold[i]
        target[i + 1] -= flat * refined.fold[i + 1]
        target[i + 2] -= flat * refined.fold[i + 2]
        // 접힘이 펴진 만큼 음영도 접힘 없는 피부의 법선으로
        x += flat * (refined.normals[i] - shown[i])
        y += flat * (refined.normals[i + 1] - shown[i + 1])
        z += flat * (refined.normals[i + 2] - shown[i + 2])
      }
      const len = Math.hypot(x, y, z) || 1
      n[i] = x / len
      n[i + 1] = y / len
      n[i + 2] = z / len
    }
    position.needsUpdate = true
    normal.needsUpdate = true
  }
}
