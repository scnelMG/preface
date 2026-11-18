import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CaptureMotionPlayer, GUIDE_PLAYBACK_RATE } from './CaptureMotionGuide'
import { CAPTURE_MOTION_STEPS } from './guideContent'

describe('CaptureMotionPlayer', () => {
  it('시연 영상을 1.3배 느리게 틀어 단계 문구를 끝까지 읽을 수 있게 한다', () => {
    const { container } = render(<CaptureMotionPlayer />)
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    fireEvent.loadedMetadata(video!)
    expect(GUIDE_PLAYBACK_RATE).toBeCloseTo(1 / 1.3)
    expect(video!.playbackRate).toBeCloseTo(GUIDE_PLAYBACK_RATE)
    expect(video!.defaultPlaybackRate).toBeCloseTo(GUIDE_PLAYBACK_RATE)
  })

  it('실시간 촬영 가이드와 같은 순서(찍는 사람 기준 오른쪽부터)로 단계를 보이고, 첫 단계는 촬영 전 검사다', () => {
    render(<CaptureMotionPlayer />)
    const track = screen.getByRole('group', { name: '촬영 순서' })
    expect(
      within(track)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['1. 촬영 전 검사', '2. 오른쪽', '3. 정면', '4. 왼쪽', '5. 정면', '6. 위', '7. 아래'])
    expect(screen.getByText('촬영 전 검사', { selector: 'strong' })).toBeInTheDocument()
  })

  it('시연 영상 소스를 모두 받지 못하면(마지막 source 오류) 정지 그림으로 바꾼다', () => {
    const { container } = render(<CaptureMotionPlayer />)
    const sources = container.querySelectorAll('video > source')
    expect(sources).toHaveLength(2)
    // 첫 source만 실패하면 브라우저가 다음 source로 넘어가니 영상을 그대로 둔다
    fireEvent.error(sources[0]!)
    expect(container.querySelector('video')).not.toBeNull()
    fireEvent.error(sources[1]!)
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img.pf-motion-media')).toHaveAttribute(
      'src',
      '/guide/capture-step-1.webp',
    )
  })

  it('받은 영상 재생이 깨지면(video 자신의 오류) 정지 그림으로 바꾼다', () => {
    const { container } = render(<CaptureMotionPlayer />)
    fireEvent.error(container.querySelector('video')!)
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img.pf-motion-media')).not.toBeNull()
  })

  it('단계 구간은 영상과 함께 만든 capture-motion.json과 같다', () => {
    const json = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/guide/capture-motion.json'), 'utf8'),
    ) as { steps: { start: number; end: number }[] }
    expect(json.steps.map(({ start, end }) => [start, end])).toEqual(
      CAPTURE_MOTION_STEPS.map(({ start, end }) => [start, end]),
    )
  })
})
