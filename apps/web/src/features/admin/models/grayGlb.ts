import { Mesh, MeshStandardMaterial, type Material, type Object3D, type Texture } from 'three'

/**
 * 회색 형상 GLB 만들기(S15P31B204-720). three를 쓰므로 `ModelDownloads`가 누를 때만 동적으로 불러온다.
 * 설명은 `glbDownload.ts` 참고.
 */

/** 앱 회색 재질(`features/viewer/eyeRig` grayMaterials)과 같은 값 */
export const GRAY_COLOR = '#b6b3b0'
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'

const asList = (material: Material | Material[]) =>
  Array.isArray(material) ? material : [material]

/** 재질이 쥔 텍스처(map·normalMap 등)를 모두 찾는다 */
function texturesOf(material: Material): Texture[] {
  const out: Texture[] = []
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && (value as Texture).isTexture)
      out.push(value as Texture)
  }
  return out
}

/**
 * `root` 아래 모든 메시 재질을 맵 없는 회색 MeshStandardMaterial로 바꾼다(제자리). 원래 재질과 텍스처는 버린다(dispose).
 * 지오메트리(UV·morph target 포함)와 skin은 건드리지 않는다(회색 재질은 정점 색을 쓰지 않는다).
 * 돌려준 `dispose()`로 새로 만든 회색 재질을 푼다.
 */
export function stripToGray(root: Object3D) {
  const made: MeshStandardMaterial[] = []
  const old = new Set<Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const original = object.material as Material | Material[]
    for (const material of asList(original)) old.add(material)
    const make = () => {
      const material = new MeshStandardMaterial({
        color: GRAY_COLOR,
        roughness: 0.8,
        metalness: 0,
      })
      made.push(material)
      return material
    }
    object.material = Array.isArray(original) ? original.map(make) : make()
  })
  for (const material of old) {
    for (const texture of texturesOf(material)) {
      const image = texture.image as { close?: () => void } | null
      texture.dispose()
      image?.close?.() // ImageBitmap
    }
    material.dispose()
  }
  return {
    materials: made,
    dispose() {
      for (const material of made) material.dispose()
    },
  }
}

/** 텍스처 GLB(Blob)를 읽어 회색 형상 GLB(ArrayBuffer)로 만든다 */
export async function grayGlb(blob: Blob): Promise<ArrayBuffer> {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { GLTFExporter }, SkeletonUtils] =
    await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      import('three/examples/jsm/exporters/GLTFExporter.js'),
      import('three/examples/jsm/utils/SkeletonUtils.js'),
    ])
  const loader = new GLTFLoader()
  // 편집실(drei useGLTF)·시안 그림과 같은 압축 해제 설정. 압축이 없으면 쓰이지 않는다
  const draco = new DRACOLoader().setDecoderPath(DRACO_PATH)
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  try {
    const gltf = await loader.parseAsync(await blob.arrayBuffer(), '')
    const root = SkeletonUtils.clone(gltf.scene)
    // 복제본은 재질을 원본과 같이 쓰므로, 원본 재질(텍스처)은 복제본을 바꿀 때 함께 버려진다
    const gray = stripToGray(root)
    try {
      const out = await new GLTFExporter().parseAsync(root, { binary: true })
      if (!(out instanceof ArrayBuffer)) throw new Error('GLB가 아닌 결과')
      return out
    } finally {
      gray.dispose()
    }
  } finally {
    draco.dispose()
  }
}
