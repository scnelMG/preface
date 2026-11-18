import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PhotoProfileEvidence } from './PhotoProfileEvidence'
import type { FaceProfile } from './faceProfile'

const { detect, close } = vi.hoisted(() => ({ detect: vi.fn(), close: vi.fn() }))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  FaceLandmarker: { createFromOptions: vi.fn(() => ({ detect, close })) },
}))

const profile: FaceProfile = {
  overall: [],
  eyes: [],
  lips: [],
  lower: [{ id: 'jaw-width-face-width', label: '턱 너비', value: '0.60배', method: '' }],
  side: [],
}

function photoResult(jawWidth: number, yaw = 0) {
  const points = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5 }))
  points[234] = { x: 0.3, y: 0.4 }
  points[454] = { x: 0.7, y: 0.4 }
  points[172] = { x: 0.5 - jawWidth / 2, y: 0.65 }
  points[397] = { x: 0.5 + jawWidth / 2, y: 0.65 }
  return {
    faceLandmarks: [points],
    facialTransformationMatrixes: [{ data: [1, 0, -Math.sin(yaw), 0, 0, 1, 0, 0, 0, 0, 1] }],
  }
}

afterEach(() => vi.unstubAllGlobals())

it.each([
  { width: 0.24, yaw: 0 },
  { width: 0.48, yaw: 0 },
  { width: 0.24, yaw: 0.4 },
])('사진과 원본 3D의 측정값을 보여 주되 조절 방향은 추정하지 않는다 (%o)', async (sample) => {
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 640
      naturalHeight = 640
      decode = async () => undefined
    },
  )
  detect.mockReturnValue(photoResult(sample.width, sample.yaw))
  render(<PhotoProfileEvidence url="/synthetic.jpg" profile={profile} section="lower" />)
  fireEvent.click(screen.getByRole('button', { name: '원본 사진과 대조하기' }))
  if (sample.yaw) {
    expect(await screen.findByText(/함께 확인할 수 있는 기준점이 부족/)).toBeVisible()
  } else {
    expect(await screen.findByText(/촬영 사진.*원본 3D/)).toBeVisible()
  }
  expect(screen.queryByRole('button', { name: /사각턱.*미리보기/ })).not.toBeInTheDocument()
  expect(close).toHaveBeenCalled()
})
