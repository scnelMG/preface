import type { BufferGeometry, Mesh, Object3D } from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { attachNeckCap } from './neckCap'

/**
 * 뷰어가 직접 만든 지오메트리 목록. useGLTF 캐시 원본은 넣지 않는다.
 * 메모가 다시 계산되거나 뷰어가 내려갈 때 `disposeOwnedGeometries`로 한 번에 해제한다(S15P31B204-802).
 */
export type OwnedGeometries = BufferGeometry[]

/**
 * 캐시된 원본 scene을 Before·After 둘로 복제하고 각각 목 마개를 붙인다.
 * SkeletonUtils 복제본은 원본과 지오메트리·재질을 같이 쓰므로, 새로 만든 마개 지오메트리만 `owned`에 담는다.
 * 마개 재질은 피부 원본 재질을 그대로 쓰므로 해제 대상이 아니다.
 */
export function cloneComparisonScenes(scene: Object3D, owned: OwnedGeometries) {
  const before = cloneSkinned(scene)
  const after = cloneSkinned(scene)
  for (const root of [before, after]) {
    const cap = attachNeckCap(root)
    if (cap) owned.push(cap.geometry)
  }
  return { before, after }
}

/** 원본과 공유하던 메시 지오메트리를 복제본으로 바꾸고, 복제본을 `owned`에 담는다 */
export function cloneMeshGeometry(mesh: Mesh, owned: OwnedGeometries) {
  mesh.geometry = mesh.geometry.clone()
  owned.push(mesh.geometry)
  return mesh.geometry
}

/** 뷰어가 만든 지오메트리를 모두 해제한다. 같은 지오메트리가 두 번 들어 있어도 한 번만 부른다 */
export function disposeOwnedGeometries(owned: OwnedGeometries) {
  for (const geometry of new Set(owned)) geometry.dispose()
}
