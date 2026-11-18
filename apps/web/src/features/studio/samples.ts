import { ASSET_BASE_URL } from '@/shared/config/env'

/**
 * 체험용 기본 모델 2종(남성·여성). 1차 MVP는 이 둘만 연다. 명세서 "편집 세션 모델 — 샘플 머리":
 * 서버 `face_model`이 아니라 FE 정적 자산이고, 시안을 저장하지 않는다.
 *
 * 텍스처 내장 공개 모델을 기존 /models/ 경로로 제공한다.
 * 출처·변경 내역·해시는 public/models/manifest.json, 라이선스는 GNM-LICENSE.txt에 있다.
 */
export type SampleKey = 'base-male' | 'base-female'

export interface SampleHead {
  key: SampleKey
  title: string
  /** 메인 체험의 남성·여성 고르기처럼 좁은 자리에 쓰는 짧은 이름 */
  shortTitle: string
  /** 타일 아래 작은 글자 */
  subtitle: string
  /** 선택한 머리 설명(Figma selection-info) */
  description: string
  meshUrl: string
  /** 모델 고르기 칸 그림. 같은 뷰어로 정면을 렌더링한 정적 WebP(-437, manifest.json `thumbnail`) */
  thumbnailUrl: string
  /**
   * 원본 쌍꺼풀 판정. manifest.json의 같은 GLB 해시에만 유효하다(sampleAssets.test가 맞춘다).
   * 2026-10-31 회색 정면 확대로 양쪽 위 눈꺼풀에 기존 접힘선이 없음을 확인했다.
   */
  eyeReview: {
    sha256: string
    L: 'absent' | 'present' | 'unknown'
    R: 'absent' | 'present' | 'unknown'
  }
  /**
   * 눈 안전 한계(엔진 단위 0~100)를 같은 GLB·판정으로 미리 잰 값. 브라우저 워커가 같은 계산에 10초 넘게 걸려
   * 눈 탭이 그동안 '확인 중'으로 잠겼다(-526). `rule`은 잴 때의 판정 기준(useEyeLimits `EYE_LIMIT_RULE`)이고,
   * 엔진 기준이 바뀌면 이 값은 쓰지 않고 브라우저에서 다시 잰다(sampleAssets.test가 다시 재라고 알린다).
   * 다시 재기: services/gpu-worker/reconstruction/tools/auto_eye_limits.mjs의 `eyeRigFromGlb`·`measureEyeLimits`에
   * 이 GLB와 `eyeReview`를 넣는다.
   */
  eyeLimits: { rule: string; limits: Partial<Record<string, number>> }
}

export const SAMPLE_HEADS: readonly SampleHead[] = [
  {
    key: 'base-male',
    title: '남성 기본 모델',
    shortTitle: '남성',
    subtitle: '기본 모델',
    description: '남성 얼굴 기준으로 변화를 체험해 보는 기본 모델.',
    meshUrl: `${ASSET_BASE_URL}/models/base-male.glb`,
    thumbnailUrl: `${ASSET_BASE_URL}/models/base-male.webp`,
    eyeReview: {
      sha256: 'c856a88dd70667f9be3e17c5eaa3d65760eedfd504a7bf4319ec6ca31bbca1c5',
      L: 'absent',
      R: 'absent',
    },
    eyeLimits: {
      rule: '0.002:0.05:5:100',
      limits: {
        'inline:height': 100,
        'inout:height': 100,
        'outline:height': 100,
        inner: 100,
        outer: 100,
        lower: 100,
        upper: 100,
      },
    },
  },
  {
    key: 'base-female',
    title: '여성 기본 모델',
    shortTitle: '여성',
    subtitle: '기본 모델',
    description: '여성 얼굴 기준으로 변화를 체험해 보는 기본 모델.',
    meshUrl: `${ASSET_BASE_URL}/models/base-female.glb`,
    thumbnailUrl: `${ASSET_BASE_URL}/models/base-female.webp`,
    eyeReview: {
      sha256: 'ab4e4d37809b382531ba923e19d7d634c38e93aae027a7265c8a4b3d685d7931',
      L: 'absent',
      R: 'absent',
    },
    eyeLimits: {
      rule: '0.002:0.05:5:100',
      limits: {
        'inline:height': 100,
        'inout:height': 100,
        'outline:height': 100,
        inner: 100,
        outer: 100,
        lower: 100,
        upper: 85,
      },
    },
  },
]

/** 주소에 기본 모델이 없거나 모르는 값이면 이 모델로 체험한다 */
export const DEFAULT_SAMPLE_KEY: SampleKey = 'base-male'

export function isSampleKey(value: string | null | undefined): value is SampleKey {
  return SAMPLE_HEADS.some((sample) => sample.key === value)
}

/** `?sample=` 값으로 체험할 기본 모델을 고른다. 없거나 모르는 값이면 남성 기본 모델 */
export function sampleFromParam(value: string | null | undefined): SampleHead {
  const key = isSampleKey(value) ? value : DEFAULT_SAMPLE_KEY
  return SAMPLE_HEADS.find((sample) => sample.key === key) ?? SAMPLE_HEADS[0]
}
