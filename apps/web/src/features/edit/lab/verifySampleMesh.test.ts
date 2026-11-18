import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { verifySampleMesh } from './verifySampleMesh'

describe('기본 모델 파일 해시 확인', () => {
  it('실제 받은 바이트의 SHA-256이 manifest와 다르면 채팅을 열지 않는다', async () => {
    const sample = SAMPLE_HEADS[0]
    const bytes = new TextEncoder().encode('synthetic-mesh')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer })),
    )
    expect(await verifySampleMesh(sample, new AbortController().signal)).toBe(false)
    vi.unstubAllGlobals()
  })
})
