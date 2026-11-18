'use client'

import { useState } from 'react'
import { MEDIAPIPE_ASSETS, poseFromResult } from '@/features/live-capture/faceTracker'
import { GUIDE } from '@/features/live-capture/guideEngine'
import { PRIVATE_TEXT } from '@/shared/analytics'
import {
  measureFaceProfile,
  type FaceProfile,
  type Point,
  type ProfileSection,
} from './faceProfile'

async function analyzePhoto(url: string) {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
  const files = await FilesetResolver.forVisionTasks(MEDIAPIPE_ASSETS.wasmBase)
  const tracker = await FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.faceModel },
    runningMode: 'IMAGE',
    numFaces: 2,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: true,
  })
  try {
    const result = tracker.detect(image)
    const pose = poseFromResult(result)
    if (
      result.faceLandmarks.length !== 1 ||
      !pose ||
      !Number.isFinite(pose.yaw) ||
      !Number.isFinite(pose.pitch) ||
      Math.abs(pose.yaw) >= GUIDE.frontTol ||
      Math.abs(pose.pitch) >= GUIDE.finalPitchTol ||
      pose.blink > GUIDE.blinkScore ||
      pose.size < GUIDE.faceMin ||
      pose.cx <= 0 ||
      pose.cx >= 1
    )
      return null

    const points = new Map<number, Point>()
    pose.landmarks.forEach(({ x, y }, index) => {
      if (x > 0 && x < 1 && y > 0 && y < 1)
        points.set(index, [x * image.naturalWidth, -y * image.naturalHeight, 0])
    })
    return measureFaceProfile(points)
  } finally {
    tracker.close()
  }
}

function pairsFor(mesh: FaceProfile, photo: FaceProfile, section: ProfileSection) {
  const parts = section === 'overall' ? (['overall', 'eyes', 'lips', 'lower'] as const) : [section]
  return parts.flatMap((part) =>
    mesh[part].flatMap((metric) => {
      const match = part !== 'side' && photo[part].find((candidate) => candidate.id === metric.id)
      return match ? [{ metric, photo: match.value }] : []
    }),
  )
}

export function PhotoProfileEvidence({
  url,
  profile,
  section,
}: {
  url: string
  profile: FaceProfile | null | undefined
  section: ProfileSection
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [photo, setPhoto] = useState<FaceProfile | null>(null)
  if (section === 'side' || !profile) return null

  async function inspect() {
    setStatus('loading')
    try {
      setPhoto(await analyzePhoto(url))
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  const pairs = photo ? pairsFor(profile, photo, section) : []

  return (
    <section
      className="mt-3 space-y-2 border-t border-hairline pt-3"
      aria-label="촬영 사진과 3D 대조"
      {...PRIVATE_TEXT}
    >
      {status === 'idle' || status === 'error' ? (
        <button type="button" className="min-h-9 text-sm underline" onClick={() => void inspect()}>
          {status === 'error' ? '사진 대조 다시 시도' : '원본 사진과 대조하기'}
        </button>
      ) : null}
      {status === 'error' ? (
        <p role="status" className="type-caption">
          사진을 분석하지 못했어요.
        </p>
      ) : null}
      {status === 'loading' ? (
        <p role="status" className="type-caption">
          정면 사진의 기준점을 확인하고 있어요.
        </p>
      ) : null}
      {status === 'done' && !pairs.length ? (
        <p role="status" className="type-caption">
          사진과 원본 3D에서 함께 확인할 수 있는 기준점이 부족해요.
        </p>
      ) : null}
      {pairs.length ? (
        <>
          <p className="type-caption text-muted-soft">
            같은 정면 기준점으로 계산한 참고 비율이에요. 사진의 각도와 표정에 따라 달라질 수 있어요.
          </p>
          <ul className="space-y-2 text-sm">
            {pairs.map(({ metric, photo }) => (
              <li key={metric.id}>
                <div>{metric.label}</div>
                <div className="type-caption text-muted-soft">
                  촬영 사진 {photo} · 원본 3D {metric.value}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
