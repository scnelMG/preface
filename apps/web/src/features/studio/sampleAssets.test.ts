// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyMorphWeights, supportedCodes } from '@/features/viewer/morphTargets'

interface Glb {
  accessors: {
    bufferView: number
    byteOffset?: number
    count: number
    componentType: number
    sparse?: { count: number }
  }[]
  bufferViews: { byteOffset: number }[]
  meshes: {
    name: string
    weights?: number[]
    extras?: { targetNames: string[] }
    primitives: { attributes: Record<string, number>; targets: Record<string, number>[] }[]
  }[]
}

const directory = new URL('../../../public/models/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
  assetVersion: string
  models: {
    key: string
    file: string
    bytes: number
    sha256: string
    morphTargets: string[]
    defaultMorphWeights: number[]
    thumbnail: { file: string; bytes: number; sha256: string }
  }[]
}

describe('기본 모델 칸 그림 (-437)', () => {
  it.each(manifest.models)('$key 정면 그림이 manifest의 크기·해시와 같은 WebP다', (model) => {
    const buffer = readFileSync(fileURLToPath(new URL(model.thumbnail.file, directory)))
    expect(buffer.length).toBe(model.thumbnail.bytes)
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(model.thumbnail.sha256)
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(buffer.subarray(8, 12).toString('ascii')).toBe('WEBP')
  })
})

describe('기본 모델 자산과 기존 코 슬라이더 계약', () => {
  it.each(manifest.models)('$key의 파일·원본·조절 방향이 기존 뷰어와 맞는다', (model) => {
    const buffer = readFileSync(fileURLToPath(new URL(model.file, directory)))
    expect(buffer.length).toBe(model.bytes)
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(model.sha256)
    expect(manifest.assetVersion).toBe('v1')
    expect(buffer.readUInt32LE(0)).toBe(0x46546c67)
    const length = buffer.readUInt32LE(12)
    const glb = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8')) as Glb
    const skin = glb.meshes.find((mesh) => mesh.name === 'skin')!
    const primitive = skin.primitives[0]
    const dictionary = Object.fromEntries(skin.extras!.targetNames.map((name, i) => [name, i]))
    const codes = ['nose.bridge_height', 'nose.tip_height', 'nose.alar_width']
    const holder = {
      morphTargetDictionary: dictionary,
      morphTargetInfluences: [...skin.weights!],
    }
    expect(holder.morphTargetInfluences.every((value) => value === 0)).toBe(true)
    expect(
      applyMorphWeights([holder], Object.fromEntries(codes.map((code) => [code, 0.25]))),
    ).toEqual([])
    for (const code of codes) expect(holder.morphTargetInfluences[dictionary[code]]).toBe(0.25)
    applyMorphWeights([holder], {}, codes)
    expect(holder.morphTargetInfluences.every((value) => value === 0)).toBe(true)

    function read(index: number) {
      const accessor = glb.accessors[index]
      expect(accessor.componentType).toBe(5126)
      const offset =
        28 + length + glb.bufferViews[accessor.bufferView].byteOffset + (accessor.byteOffset ?? 0)
      return Array.from({ length: accessor.count * 3 }, (_, i) =>
        buffer.readFloatLE(offset + i * 4),
      )
    }
    const base = read(primitive.attributes.POSITION)
    const bridge = read(primitive.targets[dictionary['nose.bridge_height']].POSITION)
    const height = read(primitive.targets[dictionary['nose.tip_height']].POSITION)
    const width = read(primitive.targets[dictionary['nose.alar_width']].POSITION)
    let bridgeForward = 0
    let tipUp = 0
    let widthOutward = 0
    for (let i = 0; i < base.length; i += 3) {
      bridgeForward += bridge[i + 2]
      tipUp += height[i + 1]
      widthOutward += base[i] * width[i]
      expect(height[i]).toBe(0)
      expect(height[i + 2]).toBe(0)
    }
    expect(bridgeForward).toBeGreaterThan(0)
    expect(tipUp).toBeGreaterThan(0)
    expect(widthOutward).toBeGreaterThan(0)
  })
})

describe('기본 모델 원본 쌍꺼풀 판정', () => {
  it.each(manifest.models)('$key 판정은 manifest의 같은 GLB 해시에만 붙어 있다', async (model) => {
    const { SAMPLE_HEADS } = await import('./samples')
    const sample = SAMPLE_HEADS.find((item) => item.key === model.key)!
    // GLB를 바꾸면 해시가 달라져 이 검사가 실패한다. 새 파일은 다시 판정한다.
    expect(sample.eyeReview.sha256).toBe(model.sha256)
  })
})

describe('기본 모델 얼굴형 변화 (-586)', () => {
  it.each(manifest.models)('$key에 검사를 통과한 양방향 타깃이 연결된다', (model) => {
    const buffer = readFileSync(fileURLToPath(new URL(model.file, directory)))
    const length = buffer.readUInt32LE(12)
    const glb = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8')) as Glb
    const skin = glb.meshes.find((mesh) => mesh.name === 'skin')!
    const names = skin.extras!.targetNames
    const code = 'contour.weight_shape'
    expect(names).toEqual(model.morphTargets)
    expect(skin.weights).toEqual(model.defaultMorphWeights)
    const dictionary = Object.fromEntries(names.map((name, index) => [name, index]))
    const holder = { morphTargetDictionary: dictionary, morphTargetInfluences: [...skin.weights!] }
    expect(supportedCodes([holder], [code])).toEqual([code])
    for (const [value, active, inactive] of [
      [-0.5, `${code}_neg`, `${code}_pos`],
      [0.5, `${code}_pos`, `${code}_neg`],
    ] as const) {
      expect(applyMorphWeights([holder], { [code]: value })).toEqual([])
      expect(holder.morphTargetInfluences[dictionary[active]]).toBe(0.5)
      expect(holder.morphTargetInfluences[dictionary[inactive]]).toBe(0)
      expect(
        glb.accessors[skin.primitives[0].targets[dictionary[active]].POSITION].sparse!.count,
      ).toBeGreaterThan(0)
    }
    applyMorphWeights([holder], {}, [code])
    expect(holder.morphTargetInfluences.every((weight) => weight === 0)).toBe(true)
  })
})

describe('기본 모델 눈 안전 한계(-526)', () => {
  it.each(manifest.models)(
    '$key 미리 잰 한계는 지금 엔진 판정 기준으로 잰 값이다',
    async (model) => {
      const { SAMPLE_HEADS } = await import('./samples')
      const { EYE_LIMIT_RULE } = await import('@/features/viewer/useEyeLimits')
      const sample = SAMPLE_HEADS.find((item) => item.key === model.key)!
      // 엔진 판정 기준이 바뀌면 화면은 이 값을 버리고 브라우저에서 다시 잰다(눈 탭이 다시 오래 잠긴다).
      // samples.ts 주석대로 auto_eye_limits.mjs로 다시 재고 rule을 함께 고친다.
      expect(sample.eyeLimits.rule).toBe(EYE_LIMIT_RULE)
      const fold = sample.eyeReview.L === 'absent' || sample.eyeReview.R === 'absent'
      const keys = [
        ...(fold ? ['inline:height', 'inout:height', 'outline:height'] : []),
        'inner',
        'outer',
        'lower',
        'upper',
      ]
      expect(Object.keys(sample.eyeLimits.limits).sort()).toEqual(keys.sort())
      for (const value of Object.values(sample.eyeLimits.limits))
        expect(value! >= 0 && value! <= 100).toBe(true)
    },
  )
})
