'use client'

/**
 * 머리 모델에 헤어 GLB를 씌운다(S15P31B204-699, FN-HAIR-01).
 *
 * Before·After 두 복제본에 같은 헤어를 자식으로 붙인다. 원본 보기를 누르고 있는 동안은 `hidden`으로 보이기만 끈다(S15P31B204-839).
 * 헤어 GLB·맞춘 사본·재질은 그대로 두니 떼면 다시 불러오거나 맞추지 않고 바로 보인다.
 * 헤어는 GNM 평균 머리 좌표라 머리 피부의 템플릿 점(정수리·이마 라인 등)에 맞추고, 못 맞추면 경계 상자에 맞춘다(hairFit.ts).
 *
 * 두피 칠(S15P31B204-703): 헤어에 `scalpPaint`가 있으면 각 복제본의 피부 메시 위에 같은 지오메트리로 칠 텍스처를 겹친다
 * (템플릿 UV라 모든 모델에 맞는다. 피부의 morph 무게 배열을 같이 써서 편집도 따라간다). 사람 헤어라인이 있으면 그 선 밖으로
 * 칠이 나오지 않게 정점 알파로 지운다(`scalpPaintFade`). 헤어를 벗기면 겹친 칠도 같이 빠져 민머리로 돌아간다.
 *
 * 머리 모양(S15P31B204-792): 통째 맞춤만으로는 볼·관자놀이가 평균 머리보다 나온 사람은 구레나룻이 피부에 묻히고, 목이 가는
 * 사람은 뒷머리가 떠서 두피 칠이 보였다. 사본을 만들어 머리카락 점을 가장 가까운 템플릿 두피 점에 묶고 그 두피 점이 그 사람
 * 머리에서 움직인 만큼 옮긴다(`followSkin`, 템플릿 피부는 public/hair/gnm-skin.bin). 귀 둘레는 그 사람 귀 위치로 옮기고
 * (`followEars`), 마지막으로 남은 작은 파고듦만 피부 밖으로 밀어낸다(`pushOutOfSkin`).
 *
 * 다시 고르기(S15P31B204-808): 맞춘 사본은 남겨 두고, 헤어를 바꿨다 돌아오면 맞춤 계산과 GPU 올리기 없이 그대로 붙인다.
 *
 * Worker 맞춤(S15P31B204-861): 맞춤 계산은 Worker에서 돌고(hairFitClient.ts → hairFit.worker.ts) 끝나면 붙인다. 레이어드컷은
 * 화면 스레드에서 2~4초 화면을 멈췄다. 편집·체험 화면은 들어온 뒤 한가할 때 헤어를 미리 받아 맞춰 두므로(useHairPrefetch)
 * 고르면 남겨 둔 사본을 바로 붙인다. 사본은 머리별로 지금 머리와 바로 전 머리까지 남는다.
 *
 * 재질: glTF 기본(PBR)은 비스듬한 각도에서 반사가 1에 가까워져 검은 머리가 하얗게 뜬다(아래에서 올려다볼 때).
 * 그 성질이 없는 Phong으로 바꾸고 광택은 약하게 둔다. 알파는 0.5에서 딱 잘라(MASK) 정렬 문제 없이 그린다.
 */
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshPhongMaterial,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { scalpPaintFade, type TemplateSkin } from '@/features/edit/hair/hairFit'
import { hairAssetOfUrl } from '@/features/edit/hair/catalog'
import {
  fitHairFor,
  hairFitKey,
  type HairFitEntry,
  hairHeadOf,
  loadTemplateSkin,
  takeFit,
} from './hairFitClient'

export function HairLayer({
  url,
  head,
  targets,
  hairline,
  onReady,
  hidden = false,
}: {
  url: string
  /** 머리 GLB 원본 장면. 경계 상자를 잰다(복제본과 좌표가 같다) */
  head: Object3D
  /** 헤어를 붙일 곳(Before·After) */
  targets: readonly Object3D[]
  /** head.glb의 사람별 헤어라인(`asset.extras["live-mirror"].hairline`, S15P31B204-722). 없으면 통째 맞춤만 한다 */
  hairline?: unknown
  onReady?: () => void
  /** 헤어와 두피 칠을 잠깐 숨긴다(원본 보기, -839). 붙인 객체의 `visible`만 바꾼다 */
  hidden?: boolean
}) {
  // meshopt 압축 GLB. 디코더는 three-stdlib에 들어 있어 따로 받지 않는다. draco는 쓰지 않는다
  const gltf = useGLTF(url, false, true)
  const invalidate = useThree((s) => s.invalidate)
  const templateSkin = useTemplateSkin()
  // 숨김을 바꿀 때 맞춤을 다시 하지 않고 보이기만 바꾼다(-839). 새로 붙일 때는 그때의 숨김을 따른다
  const hiddenNow = useRef(hidden)

  // 맞춤 계산이 실패하면 경계(Boundary)로 넘겨 헤어만 뺀다
  const [failure, setFailure] = useState<Error | null>(null)
  if (failure) throw failure

  useEffect(() => {
    const info = hairHeadOf(head, hairline)
    const { skin, pointOf, fit, curve } = info
    const asset = hairAssetOfUrl(url)
    if (targets.length === 0) {
      let hasMesh = false
      gltf.scene.traverse((object) => {
        if (object instanceof Mesh && object.geometry.getAttribute('position')?.count) {
          hasMesh = true
        }
      })
      if (
        !hasMesh ||
        !(fit.scale > 0) ||
        ![fit.scale, fit.rotationX, ...fit.position].every(Number.isFinite)
      ) {
        throw new Error('헤어를 현재 모델에 맞출 수 없어요.')
      }
      onReady?.()
      return
    }
    // 템플릿 피부를 받는 동안은 기다린다(실패하면 null: 두피 따라 옮기기 없이 씌운다)
    if (templateSkin === undefined) return

    let live = true
    let detach: (() => void) | null = null
    function attach(entry: HairFitEntry) {
      const made = entry.materials
      const attached = targets.map((target) => {
        const hair = entry.scene.clone(true)
        hair.name = 'hair'
        hair.scale.setScalar(fit.scale)
        hair.position.set(...fit.position)
        hair.rotation.set(fit.rotationX, 0, 0)
        hair.traverse((object) => {
          if (!(object instanceof Mesh)) return
          const source = object.material as Material
          let material = made.get(source)
          if (!material) {
            material = hairMaterial(source)
            made.set(source, material)
          }
          object.material = material
        })
        target.add(hair)
        return [target, hair] as const
      })
      const paint =
        asset?.scalpPaint && skin
          ? scalpPaintLayer(asset.scalpPaint, skin, curve, pointOf, invalidate)
          : null
      const overlays = paint ? targets.map((target) => paint.attach(target)) : []
      showHair(targets, !hiddenNow.current)
      invalidate()
      onReady?.()
      return () => {
        for (const [target, hair] of attached) target.remove(hair)
        for (const overlay of overlays) overlay?.removeFromParent()
        paint?.dispose()
        invalidate()
      }
    }
    // 이 머리에 이 헤어를 맞춘 적이 있으면(미리 맞춘 것 포함) 그 사본을 바로 붙인다(맞춤 계산·GPU 올리기 생략)
    const cached = takeFit(head, hairFitKey(url, templateSkin))
    if (cached) detach = attach(cached)
    else
      fitHairFor({ head, hairline, url, scene: gltf.scene, templateSkin, urgent: true }).then(
        (entry) => {
          if (live) detach = attach(entry)
        },
        (error: unknown) => {
          if (live) setFailure(error instanceof Error ? error : new Error('헤어 맞춤 계산 실패'))
        },
      )
    return () => {
      live = false
      detach?.()
    }
  }, [gltf.scene, url, head, targets, hairline, invalidate, onReady, templateSkin])

  useEffect(() => {
    hiddenNow.current = hidden
    showHair(targets, !hidden)
    invalidate()
  }, [hidden, targets, invalidate])

  return null
}

/** 복제본에 붙인 헤어(`hair`)와 두피 칠(`scalp-paint`)의 보이기만 바꾼다. 지오메트리·재질·텍스처는 그대로 둔다(-839) */
function showHair(targets: readonly Object3D[], visible: boolean) {
  for (const target of targets) {
    target.traverse((object) => {
      if (object.name === 'hair' || object.name === 'scalp-paint') object.visible = visible
    })
  }
}

/**
 * 두피 칠 한 장(텍스처·재질·지오메트리)을 만들고, 복제본마다 그 피부 메시 위에 겹칠 메시를 붙이는 함수를 돌려준다.
 * 사람 헤어라인이 있으면 지오메트리를 복사해 정점 알파(헤어라인 밖 0)를 넣고, 없으면 피부 지오메트리를 그대로 쓴다.
 */
function scalpPaintLayer(
  url: string,
  skin: Mesh,
  curve: readonly (readonly [number, number, number])[],
  pointOf: (vertex: number) => readonly [number, number, number] | null,
  invalidate: () => void,
) {
  const texture: Texture = new TextureLoader().load(url, () => invalidate())
  texture.flipY = false // glTF UV(위가 v = 0)와 같은 방향으로 구웠다
  texture.colorSpace = SRGBColorSpace
  const source = skin.geometry as BufferGeometry
  let geometry: BufferGeometry = source
  if (curve.length) {
    geometry = source.clone()
    const position = source.getAttribute('position')
    const p = new Vector3()
    const world = skin.matrixWorld
    const points = Array.from({ length: position.count }, (_, i) =>
      p.fromBufferAttribute(position, i).applyMatrix4(world).toArray(),
    )
    const fade = scalpPaintFade(points, curve, pointOf)
    const rgba = new Float32Array(position.count * 4).fill(1)
    fade.forEach((a, i) => (rgba[i * 4 + 3] = a))
    geometry.setAttribute('color', new BufferAttribute(rgba, 4))
  }
  const material = new MeshStandardMaterial({
    name: 'scalp paint',
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    roughness: 1,
    metalness: 0,
    vertexColors: geometry !== source,
  })
  return {
    attach(target: Object3D): Mesh | null {
      let targetSkin: Mesh | null = null
      target.traverse((object) => {
        if (!targetSkin && object instanceof Mesh && object.name === 'skin') targetSkin = object
      })
      if (!targetSkin) return null
      const base = targetSkin as Mesh
      const overlay =
        base instanceof SkinnedMesh
          ? new SkinnedMesh(geometry, material)
          : new Mesh(geometry, material)
      if (base instanceof SkinnedMesh && overlay instanceof SkinnedMesh) {
        overlay.bind(base.skeleton, base.bindMatrix)
      }
      overlay.name = 'scalp-paint'
      // 피부와 같은 morph 무게 배열을 써서 편집(코·윤곽)을 그대로 따라간다
      overlay.morphTargetInfluences = base.morphTargetInfluences
      overlay.morphTargetDictionary = base.morphTargetDictionary
      overlay.renderOrder = 1
      base.add(overlay)
      return overlay
    },
    dispose() {
      texture.dispose()
      material.dispose()
      if (geometry !== source) geometry.dispose()
    },
  }
}

/** 헤어 카드(텍스처 있음)는 Phong, 두피 캡(텍스처 없음)은 반사 없는 무광으로 */
export function hairMaterial(source: Material): Material {
  if (!(source instanceof MeshStandardMaterial)) return source.clone()
  if (!source.map) {
    const cap = source.clone()
    cap.roughness = 1
    cap.metalness = 0
    return cap
  }
  return new MeshPhongMaterial({
    name: source.name,
    map: source.map,
    normalMap: source.normalMap,
    vertexColors: source.vertexColors,
    alphaTest: 0.5,
    side: DoubleSide,
    specular: new Color(0x1a1a1a),
    shininess: 70,
  })
}

/** 템플릿 피부(public/hair/gnm-skin.bin)를 받는다. 받는 중 undefined, 실패하면 null */
function useTemplateSkin(): TemplateSkin | null | undefined {
  const [skin, setSkin] = useState<TemplateSkin | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void loadTemplateSkin().then((value) => {
      if (live) setSkin(value)
    })
    return () => {
      live = false
    }
  }, [])
  return skin
}
