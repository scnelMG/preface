/**
 * 브라우저 전용 파일 도구. 서버에서 부르지 않는다.
 */

/**
 * 원본 파일의 SHA-256을 base64로 만든다(API-CAP-01 `checksumSha256`, PUT `x-amz-checksum-sha256`).
 *
 * Web Crypto는 스트리밍 해시가 없어서 파일 전체를 메모리에 올린다. 250MB 영상이면
 * 휴대폰에서 수백 MB를 잠깐 쓴다. 원본을 압축·변환하지 않는다(FN-CAP-02).
 */
export async function sha256Base64(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return bytesToBase64(new Uint8Array(digest))
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
