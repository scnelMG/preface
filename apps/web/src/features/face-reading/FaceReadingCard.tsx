'use client'

import { cx } from '@/shared/ui'
import type { FaceReadingResult } from './types'
import { useFaceReading, type FaceReadingState } from './useFaceReading'
import { useFrontPhoto } from '@/features/edit/lab/FrontPhoto'
import { hasFaceReadingPhoto, useFaceReadingPhoto } from './useFaceReadingPhoto'
import { useHeadThumbnail } from './useHeadThumbnail'
import { PRIVATE_MEDIA, PRIVATE_TEXT } from '@/shared/analytics'

/** 재미용 표시. 결과 카드 맨 아래·버튼 아래에 둔다(동의서 v2 "오락용 풀이" 문구와 같은 뜻) */
export const FUN_NOTICE = '재미로 보는 풀이예요. 의학적·과학적 근거가 없고, 성형 상담이 아니에요.'

export const PHOTO_ALT = '관상에 쓴 내 얼굴 사진'
export const FRONT_PHOTO_ALT = '촬영한 내 얼굴 사진'
export const THUMBNAIL_ALT = '내 3D 얼굴'

/**
 * 3D 생성 대기 화면의 AI 관상 카드(S15P31B204-440). 영상에서 고른 정면 사진 1장으로 AI가 관상을 풀어 준다(BE -438).
 *
 * - 프레임 추출이 끝나야(`photoReady`) 요청할 수 있다. 3D가 완성되면 관상 사진이 지워져, 이미 본 관상만 다시 볼 수 있다.
 * - 3D 1개당 1건이다. 다시 들어와도 같은 결과를 보여 준다.
 * - "말이 많아 읽기 어렵다·사진도 같이"(10-29 피드백, -452): 사진 옆에 별명·종합 한 줄, 부위는 2열 한 줄씩, 조언은 칩으로.
 *   사진은 요청한 뒤에만 받고, 받은 사진은 메모리에 둬 화면 복귀·3D 완성 뒤에도 그대로 보인다(-891).
 *   3D가 완성됐는데 받아 둔 사진이 없으면(새로고침 등) 3D 완성 때 보관한 정면 사진(-604)을, 그것도 없으면
 *   내 모델 썸네일(-436)을 쓰고, 다 없으면 글만 보인다.
 * - "이렇게 바꾸면" 조언은 글로만 보여 준다. 3D 시뮬레이션과 잇는 것은 차후(설계 문서).
 *
 * 2026-10-31 모양: 흔한 카드(반짝이 아이콘·회색 칸·화살표 칩) 대신 이 서비스의 지면 구성 — 상자 없이,
 * 왼쪽 세로 사진(시안 칸과 같은 4:5), 오른쪽 큰 제목·총평, 부위 풀이는 내 정보처럼 "이름 | 풀이" 줄, 조언은 문장.
 * 보라는 쓰지 않는다. 모양은 refine.css `.pf-reading*`.
 */
export function FaceReadingCard(props: Omit<FaceReadingPanelProps, 'state'>) {
  const state = useFaceReading(props.jobId, true)
  return <FaceReadingPanel {...props} state={state} />
}

type FaceReadingPanelProps = {
  /** `useFaceReading`의 결과. 대기 화면은 버튼(`FaceReadingAction`)과 카드가 같은 상태를 쓰려고 위에서 만든다 */
  state: FaceReadingState
  jobId: string
  /** 프레임 추출이 끝났는지(QUALITY_CHECK 이후) */
  photoReady: boolean
  /** 3D가 완성됐는지. 완성 뒤에는 새로 요청할 수 없다(사진이 지워짐) */
  jobDone: boolean
  /** 완성된 3D. 관상 사진이 없을 때 정면 사진·썸네일을 찾는 데 쓴다 */
  faceModelId?: string | null
  /**
   * 카드 안에 요청 버튼을 둘지. 대기 화면은 버튼을 "내 작업실로" 옆에 두고(-523) 카드에는 진행·결과만 보인다.
   * false이면 아직 요청하지 않은 상태(idle)에서는 카드를 그리지 않는다.
   */
  showAction?: boolean
  id?: string
  className?: string
}

/** 관상 카드 본체. 상태는 밖에서 받는다 */
export function FaceReadingPanel({
  state,
  jobId,
  photoReady,
  jobDone,
  faceModelId = null,
  showAction = true,
  id,
  className,
}: FaceReadingPanelProps) {
  const { view, readingId } = state
  // 요청이 서버에 닿아 관상 기록이 생긴 뒤(readingId)에만 사진을 부른다. 먼저 부르면 404라 새로고침해야 보였다(-523).
  // 3D가 완성됐으면 서버 사진이 지워져 새로 부르지 않는다. 받아 둔 사진은 그대로 보인다(-891)
  const photo = useFaceReadingPhoto(
    jobId,
    !jobDone && readingId !== null && (view.kind === 'pending' || view.kind === 'done'),
  )
  // 3D 완성 뒤 받아 둔 관상 사진이 없으면 보관한 정면 사진(presigned 10분, 만료 전에 다시 받는다)
  const needFallback = jobDone && view.kind === 'done' && !hasFaceReadingPhoto(jobId)
  const front = useFrontPhoto(needFallback ? faceModelId : null)
  const thumbnail = useHeadThumbnail(faceModelId, needFallback && !front)
  const image = photo
    ? { src: photo, alt: PHOTO_ALT }
    : front
      ? { src: front, alt: FRONT_PHOTO_ALT }
      : thumbnail
        ? { src: thumbnail, alt: THUMBNAIL_ALT }
        : null

  if (view.kind === 'loading') return null
  // 3D가 끝났는데 본 적이 없으면 만들 수 없으니 카드를 숨긴다
  if ((jobDone && view.kind === 'idle') || view.kind === 'unavailable') return null
  // 버튼이 밖에 있으면 요청 전에는 보여 줄 것이 없다
  if (!showAction && view.kind === 'idle') return null

  const result = view.kind === 'done' ? view.reading.result : null
  return (
    <section id={id} aria-label="AI 관상" className={cx('pf-reading', className)}>
      {result ? (
        <ReadingResult result={result} image={image} />
      ) : (
        <div className="pf-reading-intro">
          <p className="pf-reading-kicker">기다리는 동안</p>
          <h2>내 얼굴로 보는 재미있는 관상</h2>
          <p className="pf-reading-lead">{READING_LEAD}</p>
          {view.kind === 'pending' ? (
            <div className="pf-reading-pending">
              {photo ? <Photo src={photo} alt={PHOTO_ALT} className="size-12" /> : null}
              <p role="status">
                <span className="pf-loader size-4" aria-hidden="true" />
                관상을 보는 중이에요. 30초쯤 걸려요.
              </p>
            </div>
          ) : (
            <>
              {view.kind === 'failed' ? (
                <p role="alert" className="pf-reading-error">
                  관상을 보지 못했어요. 다시 시도해 주세요.
                </p>
              ) : null}
              {showAction ? (
                <FaceReadingAction
                  state={state}
                  photoReady={photoReady}
                  jobDone={jobDone}
                  className="btn-primary pf-reading-action"
                />
              ) : null}
              {!photoReady || view.kind === 'notReady' ? (
                <p className="pf-reading-note">{PHOTO_NOT_READY_NOTE}</p>
              ) : null}
            </>
          )}
          <p className="pf-reading-fun">{FUN_NOTICE}</p>
        </div>
      )}
    </section>
  )
}

export const READING_LEAD =
  '촬영한 영상의 정면 사진 한 장으로 AI가 부위별 관상을 풀어 드려요. 사진은 저장하지 않아요.'
export const PHOTO_NOT_READY_NOTE = '얼굴 사진을 고르는 중이에요. 조금만 기다려 주세요.'

/**
 * 관상 요청 버튼. 아직 요청 전이거나 실패했을 때만 보인다(진행 중·결과는 카드가 보여 준다).
 * `onRequested`: 요청한 뒤 할 일(대기 화면은 카드로 스크롤).
 */
export function FaceReadingAction({
  state,
  photoReady,
  jobDone,
  onRequested,
  className,
}: {
  state: FaceReadingState
  photoReady: boolean
  jobDone: boolean
  onRequested?: () => void
  className?: string
}) {
  const { view, request } = state
  if (jobDone || (view.kind !== 'idle' && view.kind !== 'failed' && view.kind !== 'notReady')) {
    return null
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void request()
        onRequested?.()
      }}
      disabled={!photoReady || view.kind === 'notReady'}
      title={!photoReady || view.kind === 'notReady' ? PHOTO_NOT_READY_NOTE : undefined}
    >
      {view.kind === 'failed' ? '다시 시도하기' : 'AI 관상 보기'}
    </button>
  )
}

function Photo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    // blob 주소라 next/image 최적화를 거치지 않는다
    // eslint-disable-next-line @next/next/no-img-element
    <img {...PRIVATE_MEDIA} src={src} alt={alt} className={cx('pf-reading-photo', className)} />
  )
}

function ReadingResult({
  result,
  image,
}: {
  result: FaceReadingResult
  image: { src: string; alt: string } | null
}) {
  // "이렇게 바꾸면" 조언과 재미 안내. 사진이 있으면 사진 쪽 묶음에(넓은 카드는 사진 아래, 좁은 카드는 풀이 아래),
  // 없으면 풀이 아래에 둔다
  const notes = (
    <>
      <h3>이렇게 바꾸면</h3>
      <ul className="pf-reading-advice">
        {result.advice.map((item) => (
          <li key={`${item.part}-${item.change}`}>
            <strong>{item.change}</strong> <span className="pf-reading-effect">{item.effect}</span>
          </li>
        ))}
      </ul>
      <p className="pf-reading-fun">{FUN_NOTICE}</p>
    </>
  )

  return (
    // 넓은 카드: [사진·조언 | 머리글·풀이](-791, 사진 아래가 비지 않게),
    // 좁은 카드: [작은 사진 | 머리글] 아래 풀이·조언 한 단(refine.css `.pf-reading-result`)
    <div className="pf-reading-result" data-photo={image ? '' : undefined} {...PRIVATE_TEXT}>
      {image ? (
        <div className="pf-reading-side">
          <Photo src={image.src} alt={image.alt} className="pf-reading-portrait" />
          <div className="pf-reading-notes">{notes}</div>
        </div>
      ) : null}
      <div className="pf-reading-head">
        <p className="pf-reading-kicker">기다리는 동안 본 관상</p>
        <h2>{result.title}</h2>
        <p className="pf-reading-lead">{result.overall}</p>
      </div>
      <div className="pf-reading-details">
        {/* 부위 풀이: "이름 | 풀이" 줄, 부위 이름은 진하게 */}
        <dl className="pf-reading-parts">
          {result.parts.map((part) => (
            <div key={part.part}>
              <dt>{part.name}</dt>
              <dd>{part.reading}</dd>
            </div>
          ))}
        </dl>
        {image ? null : notes}
      </div>
    </div>
  )
}
