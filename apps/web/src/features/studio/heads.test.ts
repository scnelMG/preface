import { describe, expect, it } from 'vitest'
import {
  nextAfterDelete,
  buildHeadOptions,
  changedPartsLabel,
  formatFullDate,
  headTitle,
  initialHeadId,
  labHref,
  objectParticle,
  ownHeadTitle,
  particle,
  simulationHref,
  studioHref,
  validateHeadTitle,
} from './heads'
import { SAMPLE_HEADS, sampleFromParam } from './samples'
import type { FaceModelSummary } from './types'

const model = (id: string, createdAt = '2026-10-21T15:30:00Z'): FaceModelSummary => ({
  faceModelId: id,
  title: '내 모델',
  thumbnailUrl: null,
  createdAt,
  simulationCount: 0,
})

describe('buildHeadOptions', () => {
  it('게스트(내 모델 없음)는 남성·여성 기본 모델 2종만', () => {
    const options = buildHeadOptions([])
    expect(options.map(headTitle)).toEqual(['남성 기본 모델', '여성 기본 모델'])
  })

  it('회원은 내 모델을 맨 앞에 두고 샘플이 뒤따른다', () => {
    const options = buildHeadOptions([model('fm-2'), model('fm-1')])
    expect(options.map((o) => o.id)).toEqual([
      'own:fm-2',
      'own:fm-1',
      ...SAMPLE_HEADS.map((s) => `sample:${s.key}`),
    ])
  })
})

describe('ownHeadTitle', () => {
  it('서버가 준 이름을 그대로 쓰고, 비어 있을 때만 기본 이름', () => {
    expect(ownHeadTitle('봄에 찍은 머리')).toBe('봄에 찍은 머리')
    expect(ownHeadTitle('  내 모델 2 ')).toBe('내 모델 2')
    expect(ownHeadTitle('')).toBe('내 모델')
    expect(ownHeadTitle('   ')).toBe('내 모델')
    expect(ownHeadTitle(null)).toBe('내 모델')
  })

  it('목록의 내 모델 제목에 이름을 싣는다', () => {
    const [own] = buildHeadOptions([{ ...model('fm-1'), title: '봄에 찍은 머리' }])
    expect(headTitle(own)).toBe('봄에 찍은 머리')
  })
})

describe('sampleFromParam', () => {
  it('주소의 기본 모델을 고르고, 없거나 모르는 값이면 남성 기본 모델', () => {
    expect(sampleFromParam('base-female').meshUrl).toContain('/models/base-female.glb')
    expect(sampleFromParam('base-male').meshUrl).toContain('/models/base-male.glb')
    expect(sampleFromParam(null).key).toBe('base-male')
    expect(sampleFromParam('line-study').key).toBe('base-male')
  })
})

describe('initialHeadId', () => {
  const options = buildHeadOptions([model('fm-2'), model('fm-1')])

  it('주소의 faceModelId가 있으면 그 머리', () => {
    expect(initialHeadId(options, 'fm-1')).toBe('own:fm-1')
  })

  it('없거나 모르는 id면 맨 앞', () => {
    expect(initialHeadId(options, null)).toBe('own:fm-2')
    expect(initialHeadId(options, 'nope')).toBe('own:fm-2')
    expect(initialHeadId([], null)).toBeNull()
  })
})

describe('경로', () => {
  it('작업실 주소에 머리·탭을 싣는다', () => {
    expect(studioHref()).toBe('/studio')
    expect(studioHref({ faceModelId: 'fm 1' })).toBe('/studio?faceModelId=fm+1')
    expect(studioHref({ tab: 'records' })).toBe('/studio?tab=records')
    expect(studioHref({ tab: 'heads' })).toBe('/studio')
  })

  it('시안·체험 실험실 주소', () => {
    expect(simulationHref('sim/1')).toBe('/simulations/sim%2F1')
    expect(labHref('base-female')).toBe('/lab?sample=base-female')
  })
})

describe('표시 형식', () => {
  it('날짜는 서울 기준', () => {
    // UTC 15:30 = 서울 다음 날 00:30
    expect(formatFullDate('2026-10-21T15:30:00Z')).toBe('2026.10.22')
  })

  it('변경 부위', () => {
    expect(changedPartsLabel(['NOSE', 'EYE'])).toBe('코·눈')
    expect(changedPartsLabel(['LIPS'])).toBe('LIPS')
    expect(changedPartsLabel([])).toBe('')
  })

  it('목적격 조사', () => {
    expect(objectParticle('콧대를 조금 높인 시안')).toBe('을')
    expect(objectParticle('라인 스터디')).toBe('를')
    expect(objectParticle('draft')).toBe('을(를)')
    expect(objectParticle('')).toBe('을(를)')
  })

  it('숫자로 끝나는 이름은 한국어 읽기로 조사를 고른다', () => {
    const expected = ['을', '을', '를', '을', '를', '를', '을', '을', '을', '를']
    expected.forEach((josa, digit) => {
      expect(objectParticle(`내 모델 ${digit}`)).toBe(josa)
    })
    expect(objectParticle('시안 10')).toBe('을')
  })

  it('조사 쌍마다 받침에 맞는 쪽을 고른다', () => {
    expect(particle('머리', '이/가')).toBe('가')
    expect(particle('시안', '이/가')).toBe('이')
    expect(particle('머리 3', '은/는')).toBe('은')
    expect(particle('머리 5', '은/는')).toBe('는')
    expect(particle('머리 6', '과/와')).toBe('과')
    expect(particle('머리 9', '과/와')).toBe('와')
    expect(particle('draft', '이/가')).toBe('이(가)')
  })

  it('으로/로는 ㄹ 받침과 1·7·8도 로를 쓴다', () => {
    expect(particle('시안', '으로/로')).toBe('으로')
    expect(particle('머리', '으로/로')).toBe('로')
    expect(particle('얼굴', '으로/로')).toBe('로')
    expect(particle('머리 0', '으로/로')).toBe('으로')
    expect(particle('머리 3', '으로/로')).toBe('으로')
    expect(particle('머리 6', '으로/로')).toBe('으로')
    for (const digit of ['1', '7', '8', '2', '4', '5', '9']) {
      expect(particle(`머리 ${digit}`, '으로/로')).toBe('로')
    }
    expect(particle('draft', '으로/로')).toBe('(으)로')
  })
})

describe('validateHeadTitle (API-HIS-08 가안, 1~20자)', () => {
  it('앞뒤 공백을 빼고 비었거나 20자를 넘으면 문구를 준다', () => {
    expect(validateHeadTitle('')).toBe('이름을 적어 주세요.')
    expect(validateHeadTitle('   ')).toBe('이름을 적어 주세요.')
    expect(validateHeadTitle('가'.repeat(21))).toBe('이름은 20자까지예요.')
  })

  it('1~20자면 통과한다(앞뒤 공백은 세지 않는다)', () => {
    expect(validateHeadTitle('가')).toBeNull()
    expect(validateHeadTitle(`  ${'가'.repeat(20)}  `)).toBeNull()
  })
})

describe('nextAfterDelete (-799)', () => {
  const models = ['a', 'b', 'c'].map((id) => ({
    faceModelId: id,
    title: id,
    createdAt: '2026-11-01T00:00:00Z',
    thumbnailUrl: null,
    simulationCount: 0,
  }))
  const options = buildHeadOptions(models)

  it('지운 자리로 밀려 들어온 다음 모델을 고른다(맨 앞으로 돌리지 않는다)', () => {
    expect(nextAfterDelete(options, 'b')).toBe('own:c')
    expect(nextAfterDelete(options, 'a')).toBe('own:b')
  })

  it('마지막 내 모델을 지우면 뒤따르던 기본 모델이 그 자리에 온다', () => {
    expect(nextAfterDelete(options, 'c')).toBe('sample:base-male')
  })

  it('맨 끝을 지우면 바로 앞 모델, 목록에 없으면 null', () => {
    const onlyOwn = buildHeadOptions(models, [])
    expect(nextAfterDelete(onlyOwn, 'c')).toBe('own:b')
    expect(nextAfterDelete(options, 'zzz')).toBeNull()
  })
})
