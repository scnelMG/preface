import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createSyntheticGlbUrl } from '@/features/edit/syntheticMesh'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { BaseModelTrial } from './BaseModelTrial'
import { clearTutorialRecord, TUTORIAL_STORAGE_KEY } from './storage'

// 3D(three·WebGL)는 jsdom에서 돌지 않는다. 받은 값만 보여 주는 가짜로 바꾼다
vi.mock('@/features/viewer/FaceStage', () => ({
  FaceStage: (props: {
    meshUrl: string
    weights: Record<string, number>
    compare?: boolean
    onStatusChange?: (status: 'error') => void
    eyebrow?: ReactNode
  }) => (
    <>
      <p data-testid="stage-label">{props.eyebrow}</p>
      <div data-testid="face-stage" data-compare={String(props.compare)} data-mesh={props.meshUrl}>
        {JSON.stringify(props.weights)}
      </div>
      <button type="button" onClick={() => props.onStatusChange?.('error')}>
        모델 로드 실패
      </button>
    </>
  ),
}))
vi.mock('@/features/edit/syntheticMesh', () => ({ createSyntheticGlbUrl: vi.fn() }))

const desktop = vi.hoisted(() => ({ value: true }))
vi.mock('@/features/viewer/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }))

beforeEach(() => {
  desktop.value = true
  vi.mocked(createSyntheticGlbUrl).mockReset().mockResolvedValue('blob:synthetic-head')
})

afterEach(() => {
  // 기록을 지우면 구독 중인 컴포넌트가 다시 그려진다. 먼저 내린다
  cleanup()
  clearTutorialRecord()
  localStorage.clear()
})

function bubble() {
  return screen.queryByRole('dialog')
}

describe('BaseModelTrial 튜토리얼', () => {
  it('처음 방문하면 1단계(회전)를 띄운다', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    expect(bubble()).toHaveAccessibleName('돌려 보기')
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이전' })).not.toBeInTheDocument()
  })

  it('다음으로 회전 → 부위 선택 → 슬라이더 → 되돌리기 순서로 진행하고 완료를 저장한다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)

    const titles = ['돌려 보기', '부위 고르기', '슬라이더로 조절하기', '되돌리기']
    for (const [index, title] of titles.entries()) {
      expect(bubble()).toHaveAccessibleName(title)
      expect(screen.getByText(`${index + 1} / 4`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: index === 3 ? '완료' : '다음' }))
    }

    expect(bubble()).not.toBeInTheDocument()
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('이전으로 한 단계 돌아간다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    await user.click(screen.getByRole('button', { name: '다음' }))
    await user.click(screen.getByRole('button', { name: '이전' }))
    expect(bubble()).toHaveAccessibleName('돌려 보기')
  })

  it('건너뛰면 저장하고, 같은 기기에서 다시 열어도 띄우지 않는다', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<BaseModelTrial meshUrl="/head.glb" />)
    await user.click(screen.getByRole('button', { name: '건너뛰기' }))

    expect(bubble()).not.toBeInTheDocument()
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('skipped')

    unmount()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    expect(bubble()).not.toBeInTheDocument()
  })

  it('Esc는 건너뛰기다', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    fireEvent.keyDown(screen.getByRole('button', { name: '다음' }), { key: 'Escape' })
    expect(bubble()).not.toBeInTheDocument()
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('skipped')
  })

  it('이미 끝낸 기기에서는 띄우지 않고, 사용법 다시 보기로 처음부터 연다', async () => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'completed')
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    expect(bubble()).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '사용법 다시 보기' }))
    expect(bubble()).toHaveAccessibleName('돌려 보기')
  })

  it('localStorage가 막혀도 튜토리얼이 뜨고 끝낼 수 있다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)

    expect(bubble()).toHaveAccessibleName('돌려 보기')
    await user.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(bubble()).not.toBeInTheDocument()
  })

  it('단계 안내를 aria-live로 읽어 준다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText(/4단계 중 2단계, 부위 고르기/)).toHaveAttribute('aria-live', 'polite')
  })
})

describe('BaseModelTrial 체험', () => {
  beforeEach(() => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'skipped')
  })

  it('기본 모델을 비교 없이 보여 주고 코 슬라이더 3개를 둔다', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    const stage = screen.getByTestId('face-stage')
    expect(stage).toHaveAttribute('data-compare', 'false')
    expect(stage).toHaveAttribute('data-mesh', '/head.glb')
    for (const name of ['콧대', '코끝', '콧볼']) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
  })

  it('코끝은 높이 대신 돌출을 조절한다(항목별 되돌리기 버튼은 없다)', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    const slider = screen.getByRole('slider', { name: '코끝' })
    fireEvent.change(slider, { target: { value: '0.3' } })
    expect(JSON.parse(screen.getByTestId('face-stage').textContent!)).toEqual({
      'nose.tip_projection': 0.3,
    })
    expect(screen.getByText('뒤로')).toBeInTheDocument()
    expect(screen.getByText('앞으로')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '코끝 되돌리기' })).not.toBeInTheDocument()
  })

  it('meshUrl을 안 주면 기본 모델 경로를 쓴다', () => {
    render(<BaseModelTrial />)
    expect(screen.getByTestId('face-stage').dataset.mesh).toMatch(/\/models\/base-male\.glb$/)
  })

  it('세 조절은 확정 범위 -100%~+100%를 쓰고 원본 위치는 중앙이다', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    for (const slider of screen.getAllByRole('slider')) {
      expect(slider).toHaveValue('0')
      expect(slider).toHaveStyle({ '--fill': '50%' })
      expect(slider).toHaveAttribute('min', '-1')
      expect(slider).toHaveAttribute('max', '1')
    }
    const bridge = screen.getByRole('slider', { name: '콧대' })
    fireEvent.change(bridge, { target: { value: '1' } })
    expect(JSON.parse(screen.getByTestId('face-stage').textContent!)['nose.bridge_height']).toBe(1)
    expect(bridge).toHaveAttribute('aria-valuetext', '+100%')
    fireEvent.change(bridge, { target: { value: '-1' } })
    expect(JSON.parse(screen.getByTestId('face-stage').textContent!)['nose.bridge_height']).toBe(-1)
  })

  it('기본 모델 파일이 없으면 합성 모델로 바꾸고 종료 때 URL을 해제한다', async () => {
    const revoke = vi.fn()
    const original = URL.revokeObjectURL
    URL.revokeObjectURL = revoke
    try {
      const view = render(<BaseModelTrial />)
      fireEvent.click(screen.getByRole('button', { name: '모델 로드 실패' }))
      await waitFor(() =>
        expect(screen.getByTestId('face-stage')).toHaveAttribute(
          'data-mesh',
          'blob:synthetic-head',
        ),
      )
      expect(createSyntheticGlbUrl).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('slider', { name: '코끝' })).toBeDisabled()
      view.unmount()
      expect(revoke).toHaveBeenCalledWith('blob:synthetic-head')
    } finally {
      URL.revokeObjectURL = original
    }
  })

  it('사용자가 넘긴 다른 GLB 실패에는 합성 모델을 대신 보여 주지 않는다', () => {
    render(<BaseModelTrial meshUrl="/custom.glb" />)
    fireEvent.click(screen.getByRole('button', { name: '모델 로드 실패' }))
    expect(screen.getByTestId('face-stage')).toHaveAttribute('data-mesh', '/custom.glb')
    expect(createSyntheticGlbUrl).not.toHaveBeenCalled()
  })

  it('슬라이더 값을 3D에 넘기고, 모두 되돌리기로 0으로 돌린다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    const stage = screen.getByTestId('face-stage')
    const resetAll = screen.getByRole('button', { name: '모두 되돌리기' })
    expect(resetAll).toBeDisabled()

    fireEvent.change(screen.getByRole('slider', { name: '콧대' }), {
      target: { value: '0.2' },
    })
    fireEvent.change(screen.getByRole('slider', { name: '콧볼' }), {
      target: { value: '-0.3' },
    })
    expect(JSON.parse(stage.textContent ?? '')).toEqual({
      'nose.bridge_height': 0.2,
      'nose.alar_width': -0.3,
    })

    await user.click(resetAll)
    expect(JSON.parse(stage.textContent ?? '')).toEqual({})
  })

  it('체험 값을 서버로 보내거나 저장하지 않는다', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<BaseModelTrial meshUrl="/head.glb" />)
    fireEvent.change(screen.getByRole('slider', { name: '코끝' }), { target: { value: '0.3' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('모바일은 슬라이더를 접어 두고 버튼으로 펼친다', async () => {
    desktop.value = false
    const user = userEvent.setup()
    render(<BaseModelTrial meshUrl="/head.glb" />)
    const toggle = screen.getByRole('button', { name: '기본 모델로 미리 해 보기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('slider', { name: '코끝' })).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('slider', { name: '코끝' })).toBeVisible()
  })

  it('모바일에서도 튜토리얼 중에는 슬라이더를 펼친다', () => {
    localStorage.clear()
    desktop.value = false
    render(<BaseModelTrial meshUrl="/head.glb" />)
    expect(screen.getByRole('button', { name: '기본 모델로 미리 해 보기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('기본 라벨은 "기본 모델 · 내 얼굴이 아니에요"이고 모델 고르기는 없다', () => {
    render(<BaseModelTrial meshUrl="/head.glb" />)
    expect(screen.getByTestId('stage-label')).toHaveTextContent('기본 모델 · 내 얼굴이 아니에요')
    expect(screen.queryByRole('tablist', { name: '체험할 기본 모델' })).not.toBeInTheDocument()
  })
})

describe('BaseModelTrial 기본 모델 고르기(메인 게스트)', () => {
  beforeEach(() => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'skipped')
  })

  const [male, female] = SAMPLE_HEADS

  it('첫 모델(남성)로 시작하고 라벨에 모델 이름을 쓴다', () => {
    render(<BaseModelTrial models={SAMPLE_HEADS} />)
    expect(screen.getByTestId('face-stage')).toHaveAttribute('data-mesh', male.meshUrl)
    expect(screen.getByTestId('stage-label')).toHaveTextContent(
      '남성 기본 모델 · 내 얼굴이 아니에요',
    )
    const picker = screen.getByRole('tablist', { name: '체험할 기본 모델' })
    expect(within(picker).getByRole('tab', { name: '남성' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('여성으로 바꾸면 메시·라벨이 바뀌고 체험 값이 처음으로 돌아간다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial models={SAMPLE_HEADS} />)
    fireEvent.change(screen.getByRole('slider', { name: '콧대' }), {
      target: { value: '0.2' },
    })
    expect(JSON.parse(screen.getByTestId('face-stage').textContent ?? '')).toEqual({
      'nose.bridge_height': 0.2,
    })

    await user.click(screen.getByRole('tab', { name: '여성' }))

    const stage = screen.getByTestId('face-stage')
    expect(stage).toHaveAttribute('data-mesh', female.meshUrl)
    expect(JSON.parse(stage.textContent ?? '')).toEqual({})
    expect(screen.getByTestId('stage-label')).toHaveTextContent(
      '여성 기본 모델 · 내 얼굴이 아니에요',
    )
    expect(screen.getByRole('button', { name: '모두 되돌리기' })).toBeDisabled()
  })

  it('남성·여성 기본 모델 파일이 없으면 합성 머리로 체험하고, 바꾼 모델도 다시 불러 본다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial models={SAMPLE_HEADS} />)
    fireEvent.click(screen.getByRole('button', { name: '모델 로드 실패' }))
    await waitFor(() =>
      expect(screen.getByTestId('face-stage')).toHaveAttribute('data-mesh', 'blob:synthetic-head'),
    )

    await user.click(screen.getByRole('tab', { name: '여성' }))
    expect(screen.getByTestId('face-stage')).toHaveAttribute('data-mesh', female.meshUrl)
    fireEvent.click(screen.getByRole('button', { name: '모델 로드 실패' }))
    await waitFor(() =>
      expect(screen.getByTestId('face-stage')).toHaveAttribute('data-mesh', 'blob:synthetic-head'),
    )
    expect(createSyntheticGlbUrl).toHaveBeenCalledTimes(2)
  })

  it('compact에서도 슬라이더 3개와 사용법 다시 보기가 있다', async () => {
    const user = userEvent.setup()
    render(<BaseModelTrial models={SAMPLE_HEADS} compact />)
    for (const name of ['콧대', '코끝', '콧볼']) {
      expect(screen.getByRole('slider', { name })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: '사용법 다시 보기' }))
    expect(bubble()).toHaveAccessibleName('돌려 보기')
  })
})
