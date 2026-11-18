import { Group, Mesh, MeshStandardMaterial, type Object3D, SphereGeometry } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { NECK_CAP_NAME } from './neckCap'
import {
  cloneComparisonScenes,
  cloneMeshGeometry,
  disposeOwnedGeometries,
  type OwnedGeometries,
} from './viewerClones'

/** useGLTF 캐시 원본처럼 쓰는 장면: 아래가 열린 피부 하나 */
function cachedScene() {
  const geometry = new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.75)
  const material = new MeshStandardMaterial({ name: 'skin' })
  const skin = new Mesh(geometry, material)
  skin.name = 'skin'
  const scene = new Group()
  scene.add(skin)
  return { scene, geometry, material }
}

function findMesh(root: Object3D, name: string) {
  let found: Mesh | null = null
  root.traverse((object) => {
    if (!found && object instanceof Mesh && object.name === name) found = object
  })
  return found as Mesh | null
}

/** FaceViewer 메모 한 번과 같은 순서: 복제·마개 → (rig 경로) After 피부 지오메트리 복제 */
function buildLikeViewer(scene: Group) {
  const owned: OwnedGeometries = []
  const { before, after } = cloneComparisonScenes(scene, owned)
  const afterSkin = findMesh(after, 'skin')!
  cloneMeshGeometry(afterSkin, owned)
  return { before, after, owned }
}

describe('viewerClones', () => {
  it('목 마개와 복제한 피부 지오메트리만 owned에 담는다', () => {
    const { scene, geometry } = cachedScene()
    const { before, after, owned } = buildLikeViewer(scene)
    const beforeCap = findMesh(before, NECK_CAP_NAME)!
    const afterCap = findMesh(after, NECK_CAP_NAME)!
    expect(beforeCap).not.toBeNull()
    expect(afterCap).not.toBeNull()
    expect(owned).toHaveLength(3)
    expect(owned).toContain(beforeCap.geometry)
    expect(owned).toContain(afterCap.geometry)
    expect(owned).toContain(findMesh(after, 'skin')!.geometry)
    // Before 피부는 원본 지오메트리를 그대로 공유한다 → 해제 대상이 아니다
    expect(findMesh(before, 'skin')!.geometry).toBe(geometry)
    expect(owned).not.toContain(geometry)
  })

  it('다시 계산하거나 내려갈 때 만든 지오메트리는 해제하고 캐시 원본은 건드리지 않는다', () => {
    const { scene, geometry, material } = cachedScene()
    const originalDispose = vi.spyOn(geometry, 'dispose')
    const materialDispose = vi.spyOn(material, 'dispose')

    // 첫 계산 → 모델·모드가 바뀌어 다시 계산(앞의 정리 실행) → 언마운트(뒤의 정리 실행)
    const first = buildLikeViewer(scene)
    const firstSpies = first.owned.map((item) => vi.spyOn(item, 'dispose'))
    const second = buildLikeViewer(scene)
    const secondSpies = second.owned.map((item) => vi.spyOn(item, 'dispose'))

    disposeOwnedGeometries(first.owned)
    for (const spy of firstSpies) expect(spy).toHaveBeenCalledTimes(1)
    for (const spy of secondSpies) expect(spy).not.toHaveBeenCalled()

    disposeOwnedGeometries(second.owned)
    for (const spy of secondSpies) expect(spy).toHaveBeenCalledTimes(1)

    expect(originalDispose).not.toHaveBeenCalled()
    // 마개는 피부 원본 재질을 같이 쓰므로 재질도 해제하지 않는다
    expect(materialDispose).not.toHaveBeenCalled()
  })

  it('같은 지오메트리가 두 번 담겨도 한 번만 해제한다', () => {
    const geometry = new SphereGeometry()
    const spy = vi.spyOn(geometry, 'dispose')
    disposeOwnedGeometries([geometry, geometry])
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
