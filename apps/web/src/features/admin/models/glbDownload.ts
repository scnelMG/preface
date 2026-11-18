/**
 * 관리자 모델 GLB 내려받기(S15P31B204-720).
 *
 * - 텍스처 GLB: 서명 URL을 fetch로 받아(Referer 없이) Blob으로 저장한다. 주소창으로 서명 URL을 열지 않는다.
 * - 회색 형상 GLB: 같은 GLB를 브라우저에서 읽어 모든 메시 재질을 맵 없는 회색 재질(`grayMaterials`와 같은 값)로
 *   바꾼 뒤 GLTFExporter로 다시 GLB를 만든다. 재질에 텍스처가 없으니 내보낸 파일에 이미지가 들어가지 않는다.
 *   형상(정점·인덱스·morph target·skin)은 그대로 둔다.
 * - three·GLTFLoader·GLTFExporter(`grayGlb.ts`)는 누를 때만 불러온다(관리자 화면 첫 번들을 키우지 않는다).
 *
 * 서명 URL은 인자로만 받고 로그·오류 문구에 넣지 않는다.
 */

export const glbFileName = (faceModelId: string, gray = false) =>
  `face-model-${faceModelId}${gray ? '-gray' : ''}.glb`

/** 서명 URL에서 GLB를 받는다. Referer·쿠키를 보내지 않고 브라우저 캐시에 남기지 않는다 */
export async function fetchGlb(url: string): Promise<Blob> {
  const response = await fetch(url, {
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`GLB 요청 실패(${response.status})`)
  return response.blob()
}

/** Blob을 임시 object URL + `<a download>`로 저장하고 주소를 바로 푼다 */
export function saveBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = fileName
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // 클릭이 내려받기를 시작한 뒤에 푼다(같은 작업에서 바로 풀면 일부 브라우저가 놓친다)
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
}
