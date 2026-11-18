import {
  BoxGeometry,
  BufferAttribute,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  type Material,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { describe, expect, it } from 'vitest'
import { GRAY_COLOR, grayGlb, stripToGray } from './grayGlb'

// 합성 장면만 쓴다(실제 얼굴 모델·주소 없음)

function texture() {
  const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
  const map = new DataTexture(data, 2, 2, RGBAFormat)
  map.needsUpdate = true
  return map
}

function texturedScene() {
  const geometry = new BoxGeometry(1, 1, 1)
  // morph target 하나(모든 정점을 조금 민다)
  const positions = geometry.getAttribute('position')
  const offsets = new Float32Array(positions.count * 3).fill(0.1)
  geometry.morphAttributes.position = [new BufferAttribute(offsets, 3)]
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ map: texture(), normalMap: texture(), color: '#ff0000' }),
  )
  mesh.name = 'head'
  mesh.updateMorphTargets()
  // 재질 두 개를 쓰는 메시(인덱스 36개를 반씩)
  const split = new BoxGeometry(0.5, 0.5, 0.5)
  split.clearGroups()
  split.addGroup(0, 18, 0)
  split.addGroup(18, 18, 1)
  const multi = new Mesh(split, [
    new MeshStandardMaterial({ map: texture() }),
    new MeshStandardMaterial({ emissiveMap: texture() }),
  ])
  const root = new Group()
  root.add(mesh, multi)
  return { root, mesh, multi }
}

/** GLB 첫 청크(JSON)를 읽는다 */
function glbJson(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  expect(view.getUint32(0, true)).toBe(0x46546c67) // 'glTF'
  const length = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a) // 'JSON'
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)))
}

function glbBlob(buffer: ArrayBuffer) {
  return new Blob([buffer], { type: 'model/gltf-binary' })
}

describe('stripToGray', () => {
  it('모든 메시 재질을 맵 없는 회색 재질로 바꾸고 지오메트리는 그대로 둔다', () => {
    const { root, mesh, multi } = texturedScene()
    const geometry = mesh.geometry
    const result = stripToGray(root)

    const materials = [mesh.material, ...(multi.material as Material[])] as MeshStandardMaterial[]
    expect(materials).toHaveLength(3)
    for (const material of materials) {
      expect(material).toBeInstanceOf(MeshStandardMaterial)
      expect(material.color.getHexString()).toBe(GRAY_COLOR.slice(1))
      expect(material.roughness).toBe(0.8)
      expect(material.metalness).toBe(0)
      for (const value of Object.values(material))
        expect((value as { isTexture?: boolean } | null)?.isTexture).not.toBe(true)
    }
    expect(mesh.geometry).toBe(geometry)
    expect(mesh.geometry.morphAttributes.position).toHaveLength(1)
    expect(result.materials).toHaveLength(3)
    result.dispose()
  })

  it('내보낸 GLB에 이미지·텍스처가 없다', async () => {
    const { root } = texturedScene()
    const gray = stripToGray(root)
    const out = await new GLTFExporter().parseAsync(root, { binary: true })
    gray.dispose()
    expect(out).toBeInstanceOf(ArrayBuffer)
    const json = glbJson(out as ArrayBuffer)
    expect(json.images).toBeUndefined()
    expect(json.textures).toBeUndefined()
    expect(json.materials.length).toBeGreaterThan(0)
  })
})

describe('grayGlb', () => {
  it('GLB를 읽어 회색 재질로 다시 내보내고 morph target을 지킨다', async () => {
    const { root } = texturedScene()
    // 입력 GLB는 텍스처 없이 만든다(jsdom에는 그림을 그릴 canvas가 없다). 재질 색은 빨강
    stripToGray(root)
    root.traverse((object) => {
      if (object instanceof Mesh)
        for (const material of [object.material].flat() as MeshStandardMaterial[])
          material.color.set('#ff0000')
    })
    const input = (await new GLTFExporter().parseAsync(root, { binary: true })) as ArrayBuffer

    const out = await grayGlb(glbBlob(input))
    const json = glbJson(out)
    expect(json.images).toBeUndefined()
    expect(json.textures).toBeUndefined()
    for (const material of json.materials) {
      const [r, g, b] = material.pbrMetallicRoughness.baseColorFactor
      // #b6b3b0(sRGB)를 선형으로 바꾼 값이라 셋이 거의 같고 빨강이 아니다
      expect(Math.abs(r - g)).toBeLessThan(0.05)
      expect(Math.abs(g - b)).toBeLessThan(0.05)
      expect(material.pbrMetallicRoughness.baseColorTexture).toBeUndefined()
    }
    const targets = json.meshes.flatMap(
      (mesh: { primitives: { targets?: unknown[] }[] }) => mesh.primitives,
    )
    expect(targets.some((primitive: { targets?: unknown[] }) => primitive.targets?.length)).toBe(
      true,
    )
  })
})
