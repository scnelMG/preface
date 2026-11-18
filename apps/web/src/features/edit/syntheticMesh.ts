/**
 * 합성 머리 GLB(blob 주소). **실제 얼굴 스캔이 아니다**(features/viewer/syntheticHead).
 *
 * 저장소에 라이선스가 확인된 기본 모델 GLB(`/models/base-head.glb`)가 아직 없어서,
 * 비로그인 체험에서 기본 모델을 못 불러오면 이것으로 대신 보여 준다. three는 여기서만 동적으로 불러온다.
 * 다 쓰면 `URL.revokeObjectURL`로 놓아 준다.
 */
export async function createSyntheticGlbUrl(): Promise<string> {
  const [{ createSyntheticHead }, { GLTFExporter }] = await Promise.all([
    import('@/features/viewer/syntheticHead'),
    import('three/examples/jsm/exporters/GLTFExporter.js'),
  ])
  const glb = await new GLTFExporter().parseAsync(createSyntheticHead(), { binary: true })
  return URL.createObjectURL(new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' }))
}
