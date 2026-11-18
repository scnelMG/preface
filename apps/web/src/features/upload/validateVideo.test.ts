import { describe, expect, it } from 'vitest'
import { DEFAULT_UPLOAD_POLICY, formatClock, resolveContentType } from './policy'
import { issueMessage, issuesFromCap002, validateVideo, type VideoMeta } from './validateVideo'

const OK: VideoMeta = { contentType: 'video/mp4', sizeBytes: 100_000_000, durationMs: 35_000 }
const kinds = (meta: Partial<VideoMeta>) =>
  validateVideo({ ...OK, ...meta }, DEFAULT_UPLOAD_POLICY).map((i) => i.kind)

describe('validateVideo — 길이·크기·형식', () => {
  it('정책 안이면 문제 없음', () => {
    expect(kinds({})).toEqual([])
  })

  it.each([
    [20_000, []],
    [75_000, []],
    [19_999, ['too-short']],
    [75_001, ['too-long']],
  ])('길이 %dms → %j (경계 포함)', (durationMs, expected) => {
    expect(kinds({ durationMs })).toEqual(expected)
  })

  it('250MB(262,144,000 바이트)까지 허용하고 넘으면 거부', () => {
    expect(kinds({ sizeBytes: 262_144_000 })).toEqual([])
    expect(kinds({ sizeBytes: 262_144_001 })).toEqual(['size'])
  })

  it.each(['video/mp4', 'video/webm', 'video/quicktime'])('%s 허용', (contentType) => {
    expect(kinds({ contentType })).toEqual([])
  })

  it('허용 외 형식·형식 모름은 거부', () => {
    expect(kinds({ contentType: 'video/3gpp' })).toEqual(['type'])
    expect(kinds({ contentType: null })).toEqual(['type'])
  })

  it('길이를 못 읽으면 올릴 수 없다', () => {
    expect(kinds({ durationMs: null })).toEqual(['duration-unknown'])
    expect(kinds({ durationMs: Number.POSITIVE_INFINITY })).toEqual(['duration-unknown'])
  })

  it('문제가 여럿이면 모두 알려 준다', () => {
    expect(
      kinds({ contentType: 'video/3gpp', sizeBytes: 300_000_000, durationMs: 10_000 }),
    ).toEqual(['type', 'size', 'too-short'])
  })

  it('서버 정책(API-CAP-02)이 바뀌면 그 값으로 검사한다', () => {
    const policy = {
      ...DEFAULT_UPLOAD_POLICY,
      video: { ...DEFAULT_UPLOAD_POLICY.video, minDurationMs: 30_000 },
    }
    expect(validateVideo({ ...OK, durationMs: 28_000 }, policy)).toEqual([
      { kind: 'too-short', minDurationMs: 30_000 },
    ])
    expect(issueMessage({ kind: 'too-short', minDurationMs: 30_000 })).toBe(
      '영상이 너무 짧아요. 30초 이상 찍어 주세요.',
    )
  })
})

describe('문구', () => {
  it('정책 값으로 문구를 만든다', () => {
    expect(issueMessage({ kind: 'size', maxSizeBytes: 262_144_000 })).toBe(
      '영상 용량이 너무 커요. 250MB 이하로 찍어 주세요.',
    )
    expect(issueMessage({ kind: 'too-long', maxDurationMs: 45_000 })).toBe(
      '영상이 너무 길어요. 45초 이하로 찍어 주세요.',
    )
    expect(
      issueMessage({ kind: 'type', allowed: DEFAULT_UPLOAD_POLICY.video.allowedContentTypes }),
    ).toBe('mp4·webm·mov 영상만 올릴 수 있어요.')
  })

  it.each([
    [36_000, '0:36'],
    [45_000, '0:45'],
    [5_400, '0:05'],
    [65_000, '1:05'],
  ])('formatClock(%d) = %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text)
  })
})

describe('resolveContentType', () => {
  it('file.type이 있으면 그대로 쓴다', () => {
    expect(resolveContentType({ name: 'a.mov', type: 'video/quicktime' })).toBe('video/quicktime')
  })

  it.each([
    ['IMG_0001.MOV', 'video/quicktime'],
    ['clip.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['clip.avi', null],
    ['noext', null],
  ])('type이 비면 확장자로 추정: %s → %s', (name, expected) => {
    expect(resolveContentType({ name, type: '' })).toBe(expected)
  })
})

describe('issuesFromCap002 — 서버 거부 details 읽기(v2.8 형식)', () => {
  const details = [
    { field: 'sizeBytes', reason: 'maxSizeBytes=262144000' },
    { field: 'durationMs', reason: 'minDurationMs=25000,maxDurationMs=45000' },
  ]

  it('크기·길이 위반을 서버 값으로 바꾼다', () => {
    expect(issuesFromCap002(details, { durationMs: 50_000 }, DEFAULT_UPLOAD_POLICY)).toEqual([
      { kind: 'size', maxSizeBytes: 262_144_000 },
      { kind: 'too-long', maxDurationMs: 45_000 },
    ])
  })

  it('보낸 길이가 최소보다 짧으면 too-short', () => {
    expect(issuesFromCap002([details[1]], { durationMs: 10_000 }, DEFAULT_UPLOAD_POLICY)).toEqual([
      { kind: 'too-short', minDurationMs: 25_000 },
    ])
  })

  it('서버 값이 FE 기본값과 다르면 서버 값을 쓴다', () => {
    expect(
      issuesFromCap002(
        [{ field: 'sizeBytes', reason: 'maxSizeBytes=104857600' }],
        { durationMs: 35_000 },
        DEFAULT_UPLOAD_POLICY,
      ),
    ).toEqual([{ kind: 'size', maxSizeBytes: 104_857_600 }])
  })

  it('형식 위반·사유 없음·모르는 필드', () => {
    expect(
      issuesFromCap002(
        [
          { field: 'contentType', reason: '' },
          { field: 'sizeBytes', reason: 'garbage' },
          { field: 'unknown', reason: 'x=1' },
        ],
        { durationMs: 35_000 },
        DEFAULT_UPLOAD_POLICY,
      ).map((i) => i.kind),
    ).toEqual(['type', 'size'])
  })
})
