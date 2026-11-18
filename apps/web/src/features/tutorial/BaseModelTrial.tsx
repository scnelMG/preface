'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createSyntheticGlbUrl } from '@/features/edit/syntheticMesh'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { BASE_MODEL_MESH_URL } from '@/features/viewer/assets'
import { FaceStage } from '@/features/viewer/FaceStage'
import type { ViewerStatus } from '@/features/viewer/types'
import { useIsDesktop } from '@/features/viewer/useIsDesktop'
import { Button, cx, Icon, SliderRow, Tab, TabList } from '@/shared/ui'
import { Coachmark } from './Coachmark'
import { TRIAL_TUTORIAL_STEPS, type TrialStepId } from './steps'
import { TUTORIAL_STORAGE_KEY } from './storage'
import { useTutorial } from './useTutorial'

/**
 * 기본 모델(GNM) 체험 + 첫 사용 튜토리얼(REQ-F-09, FN-REC-04). 메인(-277)과 3D 생성 대기(SCR-08, -194)에 붙인다.
 *
 * Figma Wireframe v3.2 최종 `SCR-08 3D 생성 대기`의 ② 기본 모델 3D · ③ 기본 모델 체험을 따른다.
 * - Desktop: 3D 아래에 슬라이더 카드가 늘 펼쳐져 있다
 * - Mobile: 슬라이더 카드가 "기본 모델로 미리 해 보기"로 접혀 있다. 튜토리얼 중에는 펼친다
 *
 * **체험 값은 이 컴포넌트 안에만 있다.** 편집 스토어(`features/edit/store`)·서버·내 3D로 넘기지 않는다
 * (REQ-F-09 "체험값은 내 3D로 전달하지 않고 서버에 저장하지 않는다"). 화면을 떠나면 사라진다.
 *
 * 기본 모델 GLB(`BASE_MODEL_MESH_URL`, 남성·여성 기본 모델)가 없으면(404) 합성 머리로 체험한다.
 * 사용자가 넘긴 다른 GLB의 오류는 그대로 표시한다.
 *
 * `models`를 넘기면(메인 게스트) 3D 오른쪽 위에서 기본 모델을 고른다. 바꾸면 체험 값은 처음으로 돌아간다.
 * `compact`는 메인 시작 카드가 한 화면에 들어가도록 3D 높이와 슬라이더 간격을 줄인다.
 */
export interface TrialModel {
  key: string
  /** 3D 라벨에 쓰는 이름. 예: 남성 기본 모델 */
  title: string
  /** 고르기 버튼에 쓰는 짧은 이름. 예: 남성 */
  shortTitle: string
  meshUrl: string
}

export interface BaseModelTrialProps {
  /** 기본값 `BASE_MODEL_MESH_URL`. 확인용 페이지는 합성 머리를 넘긴다. `models`를 넘기면 쓰지 않는다 */
  meshUrl?: string
  /** 고를 수 있는 기본 모델. 첫 항목으로 시작한다 */
  models?: readonly TrialModel[]
  /** 메인처럼 한 화면에 담아야 하는 곳에서 3D·슬라이더를 촘촘하게 */
  compact?: boolean
  /** 슬라이더 카드 첫 줄 안내 */
  intro?: ReactNode
  /** 튜토리얼 완료 기록 키. 기본 `preface.tutorial.v1` */
  storageKey?: string
  className?: string
}

interface TrialItem {
  code: string
  label: string
  min: number
  max: number
  step: number
  minLabel: string
  maxLabel: string
}

/**
 * 코 3줄(콧대 높이·코끝 돌출·콧볼 너비). 메인 체험의 코끝은 앞뒤 돌출을 조절한다.
 * 체험은 로그인 전에도 보이므로 API를 부르지 않고 확정한 상대값 범위(-1~1)를 쓴다.
 */
const TRIAL_ITEMS: readonly TrialItem[] = [
  {
    code: 'nose.bridge_height',
    label: '콧대',
    min: -1,
    max: 1,
    step: 0.05,
    minLabel: '낮게',
    maxLabel: '높게',
  },
  {
    code: 'nose.tip_projection',
    label: '코끝',
    min: -1,
    max: 1,
    step: 0.05,
    minLabel: '뒤로',
    maxLabel: '앞으로',
  },
  {
    code: 'nose.alar_width',
    label: '콧볼',
    min: -1,
    max: 1,
    step: 0.05,
    minLabel: '좁게',
    maxLabel: '넓게',
  },
]

const DEFAULT_INTRO = '기다리는 동안 기본 모델로 코 조절을 미리 해 보세요.'
const DEFAULT_LABEL = '기본 모델'

/** 파일이 없으면 합성 머리로 대신할 정적 기본 모델 */
const BUILT_IN_MESH_URLS: ReadonlySet<string> = new Set([
  BASE_MODEL_MESH_URL,
  ...SAMPLE_HEADS.map((sample) => sample.meshUrl),
])

export function BaseModelTrial({
  meshUrl: meshUrlProp = BASE_MODEL_MESH_URL,
  models,
  compact = false,
  intro = DEFAULT_INTRO,
  storageKey = TUTORIAL_STORAGE_KEY,
  className,
}: BaseModelTrialProps) {
  const isDesktop = useIsDesktop()
  const tutorial = useTutorial(TRIAL_TUTORIAL_STEPS.length, storageKey)
  const touring = tutorial.status === 'active'

  const [weights, setWeights] = useState<Record<string, number>>({})
  const [open, setOpen] = useState(false)
  const [modelKey, setModelKey] = useState<string | null>(null)
  const model = models?.find((item) => item.key === modelKey) ?? models?.[0] ?? null
  const meshUrl = model?.meshUrl ?? meshUrlProp
  // 불러오지 못한 기본 모델 주소. 다른 모델로 바꾸면 그 모델을 다시 불러 본다
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [synthetic, setSynthetic] = useState<{ source: string; url: string } | null>(null)
  const expanded = isDesktop || open || touring

  useEffect(() => {
    if (!failedUrl) return
    let disposed = false
    let created: string | null = null
    createSyntheticGlbUrl()
      .then((url) => {
        created = url
        if (disposed) URL.revokeObjectURL?.(url)
        else setSynthetic({ source: failedUrl, url })
      })
      .catch(() => {})
    return () => {
      disposed = true
      if (created) URL.revokeObjectURL?.(created)
    }
  }, [failedUrl])

  const displayUrl = synthetic?.source === meshUrl ? synthetic.url : meshUrl
  const onViewerStatus = (status: ViewerStatus) => {
    if (status === 'error' && BUILT_IN_MESH_URLS.has(meshUrl)) setFailedUrl(meshUrl)
  }
  const chooseModel = (key: string) => {
    if (key === model?.key) return
    setModelKey(key)
    setWeights({})
  }
  const panelId = useId()

  const restartButton =
    tutorial.status === 'done' ? (
      <button
        type="button"
        onClick={tutorial.restart}
        className="type-kr-caption-11-regular-lh14p3 self-start rounded-4 text-text-muted underline underline-offset-2"
      >
        사용법 다시 보기
      </button>
    ) : null

  const rootRef = useRef<HTMLElement>(null)
  // 단계 대상은 data 속성으로 찾는다. 효과(effect) 안에서만 부른다
  const getTarget = useCallback(
    (id: string) =>
      rootRef.current?.querySelector<HTMLElement>(`[data-tutorial-target="${id}"]`) ?? null,
    [],
  )
  const target = (id: TrialStepId) => ({ 'data-tutorial-target': id })

  const setWeight = (code: string, value: number) =>
    setWeights((prev) => ({ ...prev, [code]: value }))
  const resetAll = () => setWeights({})
  const changed = Object.values(weights).some((value) => value !== 0)

  return (
    <section
      ref={rootRef}
      aria-label="기본 모델 체험"
      className={cx(
        'relative flex flex-col',
        compact ? 'gap-(--space-10)' : 'gap-(--space-12)',
        className,
      )}
    >
      <div
        {...target('rotate')}
        className={cx(
          'relative overflow-hidden rounded-8',
          compact ? 'h-75 md:h-80' : 'h-75 md:h-90',
        )}
      >
        <FaceStage
          meshUrl={displayUrl}
          weights={weights}
          compare={false}
          onStatusChange={onViewerStatus}
          eyebrow={
            // Figma `② 기본 모델 3D`의 흰 라벨. FaceStage의 영문 eyebrow 글꼴·자간을 덮어쓴다
            <span className="type-kr-caption-10-medium-lh13 inline-block rounded-12 bg-bg-surface px-(--space-10) py-(--space-6) tracking-normal text-text-ink">
              {model?.title ?? DEFAULT_LABEL} · 내 얼굴이 아니에요
            </span>
          }
        />
        {models && models.length > 1 ? (
          // FaceStage 머리 줄 오른쪽(비교를 끄면 비어 있다)에 겹친다
          <TabList
            variant="pill"
            value={model?.key ?? ''}
            onChange={chooseModel}
            aria-label="체험할 기본 모델"
            className="absolute top-(--space-12) right-(--space-14) items-center gap-(--space-2) rounded-5 border border-line-default bg-bg-canvas p-(--space-4)"
          >
            {models.map((item) => (
              <Tab key={item.key} value={item.key}>
                {item.shortTitle}
              </Tab>
            ))}
          </TabList>
        ) : null}
      </div>

      <div className="rounded-8 border border-line-default bg-bg-surface">
        {isDesktop ? null : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setOpen((prev) => !prev)}
            className="flex min-h-12 w-full items-center justify-between px-(--space-16) text-text-ink"
          >
            <span className="type-kr-body-13-medium-lh16p9">기본 모델로 미리 해 보기</span>
            <Icon
              name="CaretRight"
              size={16}
              className={cx('transition-transform', expanded && 'rotate-90')}
            />
          </button>
        )}

        <div
          id={panelId}
          hidden={!expanded}
          className={cx(
            'flex flex-col',
            compact
              ? 'gap-(--space-12) px-(--space-16) pt-(--space-12) pb-(--space-14)'
              : 'gap-(--space-16) px-(--space-20) pt-(--space-16) pb-(--space-20)',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-(--space-12)">
            <div className="flex flex-wrap items-center gap-x-(--space-12) gap-y-(--space-4)">
              <p className="type-kr-caption-11-regular-lh14p3 text-text-body">{intro}</p>
              {/* compact는 한 줄을 아끼려고 안내 옆에 둔다 */}
              {compact ? restartButton : null}
            </div>
            <div className="flex items-center gap-(--space-8)">
              <div {...target('part')} className="rounded-5">
                <TabList
                  variant="pill"
                  value="NOSE"
                  onChange={() => {}}
                  aria-label="체험 부위"
                  className="items-center gap-(--space-2) rounded-5 border border-line-default bg-bg-canvas p-(--space-4)"
                >
                  <Tab value="NOSE">코</Tab>
                </TabList>
              </div>
              <div {...target('undo')} className="rounded-6">
                <Button
                  variant="text"
                  layout="wrapped"
                  leadingIcon="ArrowCounterClockwise"
                  trailingIcon={null}
                  onClick={resetAll}
                  disabled={!changed}
                >
                  모두 되돌리기
                </Button>
              </div>
            </div>
          </div>

          <div
            {...target('slider')}
            className={cx('flex flex-col', compact ? 'gap-(--space-12)' : 'gap-(--space-20)')}
          >
            {TRIAL_ITEMS.map((item) => (
              <SliderRow
                key={item.code}
                label={item.label}
                min={item.min}
                max={item.max}
                step={item.step}
                value={weights[item.code] ?? 0}
                onChange={(value) => setWeight(item.code, value)}
                minLabel={item.minLabel}
                maxLabel={item.maxLabel}
                compact={compact}
                disabled={item.code === 'nose.tip_projection' && displayUrl === synthetic?.url}
              />
            ))}
          </div>

          {compact ? null : restartButton}
        </div>
      </div>

      {touring ? (
        <Coachmark
          steps={TRIAL_TUTORIAL_STEPS}
          step={tutorial.step}
          container={rootRef}
          getTarget={getTarget}
          onNext={tutorial.next}
          onBack={tutorial.back}
          onSkip={tutorial.skip}
        />
      ) : null}
    </section>
  )
}
