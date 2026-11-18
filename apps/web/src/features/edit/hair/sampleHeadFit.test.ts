import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expectedScale, fitHairToLandmarks, HAIR_LANDMARKS } from './hairFit'

/**
 * 체험의 기본 모델(base-male·base-female)에도 헤어가 점 맞춤으로 앉는지(S15P31B204-770).
 * 기본 모델은 GNM 템플릿 위상 GLB라 피부(`skin`)에 `_TEMPLATE_INDEX`가 있다. HairLayer와 같은 방식으로 템플릿 점을 찾아
 * `fitHairToLandmarks`가 경계 상자 맞춤으로 빠지지 않는지 본다. 파일은 압축 없이 float 위치·uint 번호를 담고 있다.
 */
function readSkin(name: string) {
  const path = resolve(process.cwd(), `public/models/${name}.glb`)
  const glb = readFileSync(path)
  const jsonLength = glb.readUInt32LE(12)
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength + 8
  const node = json.nodes.find((n: { name?: string }) => n.name === 'skin')
  const attributes = json.meshes[node.mesh].primitives[0].attributes
  const read = (accessorIndex: number) => {
    const accessor = json.accessors[accessorIndex]
    const view = json.bufferViews[accessor.bufferView]
    const offset = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const size = accessor.type === 'VEC3' ? 3 : 1
    const bytes = glb.buffer.slice(
      glb.byteOffset + offset,
      glb.byteOffset + offset + accessor.count * size * 4,
    )
    return accessor.componentType === 5126 ? new Float32Array(bytes) : new Uint32Array(bytes)
  }
  const position = read(attributes.POSITION)
  const template = read(attributes._TEMPLATE_INDEX)
  const index = new Map<number, number>()
  template.forEach((id, i) => {
    if (!index.has(id)) index.set(id, i)
  })
  return (vertex: number): [number, number, number] | null => {
    const i = index.get(vertex)
    return i === undefined ? null : [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]]
  }
}

describe.each(['base-male', 'base-female'])('기본 모델 %s의 헤어 맞춤', (name) => {
  const pointOf = readSkin(name)

  it('헤어 맞춤 점을 모두 템플릿 번호로 찾는다', () => {
    for (const mark of HAIR_LANDMARKS) expect(pointOf(mark.vertex), mark.name).not.toBeNull()
  })

  it('경계 상자로 빠지지 않고 점 맞춤이 된다(크기 약 1배, 정수리가 머리 위)', () => {
    const fit = fitHairToLandmarks(pointOf)
    expect(fit).not.toBeNull()
    expect(fit!.scale).toBeGreaterThan(expectedScale(pointOf) * 0.8)
    expect(fit!.scale).toBeLessThan(expectedScale(pointOf) * 1.25)
    // 템플릿 정수리 점을 옮기면 이 머리의 정수리 근처(1cm 안)에 온다
    const crown = HAIR_LANDMARKS.find((mark) => mark.name === 'crown')!
    const head = pointOf(crown.vertex)!
    const c = Math.cos(fit!.rotationX)
    const s = Math.sin(fit!.rotationX)
    const [x, y, z] = crown.at
    const placed = [
      x * fit!.scale + fit!.position[0],
      (y * c - z * s) * fit!.scale + fit!.position[1],
      (y * s + z * c) * fit!.scale + fit!.position[2],
    ]
    expect(Math.hypot(...placed.map((v, i) => v - head[i]))).toBeLessThan(0.01)
  })
})
