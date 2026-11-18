/**
 * 내 모델 썸네일 그림 만들기(S15P31B204-436). 기본 모델 그림(-437, `public/models/*.webp`)과 같은 모양이 되게
 * 투명 배경 캔버스를 그림이 있는 범위로 자르고 6% 여백을 둔 뒤 높이 320px WebP로 만든다.
 */
export const THUMBNAIL_HEIGHT = 320
const MARGIN = 0.06
const QUALITY = 0.86

/** 알파가 있는 픽셀의 범위. 아무것도 없으면 null */
export function alphaBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

/** WebGL 캔버스 → 잘라 줄인 WebP. 그려진 것이 없거나 WebP를 못 만들면 null */
export async function canvasToThumbnail(source: HTMLCanvasElement): Promise<Blob | null> {
  const copy = document.createElement('canvas')
  copy.width = source.width
  copy.height = source.height
  const context = copy.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0)
  const bounds = alphaBounds(
    context.getImageData(0, 0, copy.width, copy.height).data,
    copy.width,
    copy.height,
  )
  if (!bounds) return null
  const pad = Math.round((bounds.y1 - bounds.y0) * MARGIN)
  const sx = Math.max(0, bounds.x0 - pad)
  const sy = Math.max(0, bounds.y0 - pad)
  const sw = Math.min(copy.width, bounds.x1 + pad) - sx
  const sh = Math.min(copy.height, bounds.y1 + pad) - sy
  const out = document.createElement('canvas')
  out.height = THUMBNAIL_HEIGHT
  out.width = Math.round((sw * THUMBNAIL_HEIGHT) / sh)
  const outContext = out.getContext('2d')
  if (!outContext) return null
  outContext.imageSmoothingQuality = 'high'
  outContext.drawImage(copy, sx, sy, sw, sh, 0, 0, out.width, out.height)
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, 'image/webp', QUALITY),
  )
  return blob && blob.type === 'image/webp' ? blob : null
}
