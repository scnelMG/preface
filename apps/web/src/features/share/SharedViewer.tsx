'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { viewerWeights } from '@/features/edit/editLogic'
import { hairUrlOf } from '@/features/edit/hair/catalog'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import type { CompareSide, ViewRequest } from '@/features/viewer/types'
import { SIMULATION_NOTICE, ViewerHints } from '@/features/viewer/ViewerHints'
import { PRIVATE_TEXT } from '@/shared/analytics'
import { BrandBar } from '@/shared/ui/BrandBar'
import { Icon } from '@/shared/ui/Icon'
import { Segmented } from '@/shared/ui/Segmented'
import { formatShareExpiry } from './expiry'
import { useSharedView } from './useSharedView'

const UNAVAILABLE = '링크가 만료되었거나 공유가 끝났어요'
const SIDES = [
  { value: 'before', label: '원래 얼굴' },
  { value: 'after', label: '바꾼 얼굴' },
] as const satisfies readonly { value: CompareSide; label: string }[]
/** 정면·측면 버튼을 뺐으므로 카메라는 예전 기본 시점(정면)에 고정한다. 바뀌지 않으니 nonce도 0 그대로다 */
const FRONT_VIEW: ViewRequest = { preset: 'front', nonce: 0 }

/**
 * 공유받은 시안 보기(설계 docs/design/simulation-share.md 4절 ②). 로그인·편집 없음.
 *
 * 편집 props(점 편집·코 손잡이·눈 편집 콜백)는 넘기지 않아 화면에서 바꿀 수 없다. 눈 편집은 상태와 판정이 모두 있을 때만 그린다.
 * 헤어는 공유할 때 씌워 둔 웹 헤어(`hairAssetId`)를 편집실과 같은 HairLayer로 원래 얼굴·결과 둘 다에 씌운다(S15P31B204-842).
 * 목록에서 빠진 헤어 ID면 헤어 없이 그린다. 헤어를 못 불러와도 얼굴은 그대로 보인다(뷰어가 헤어만 뺀다).
 *
 * 정면·측면 버튼은 두지 않는다(S15P31B204-892). 카메라는 뷰어 기본 시점(정면)에서 시작하고 끌어 돌려 본다.
 * 위에는 로고만 둔다(S15P31B204-841). 받은 사람이 눌러 메인으로 나가지 않게 링크가 아닌 글자다(BrandBar link={false}).
 * 뷰어는 편집실·메인 체험처럼 오른쪽 버튼으로 끌어 옮길 수 있고(기본 옮기기 한계), 그 아래에 같은 조작 안내를 둔다.
 *
 * 화면 짜임(디자인 시스템 v4, 메인 체험 무대와 같은 말투):
 * - 가운데 제목(보낸 사람 이름이 있으면 "OO님이 보낸 시안") → 3D 무대(남는 높이를 다 쓴다, 뒤에 은은한 빛) → 조작 안내 → 원래·바꾼 얼굴 비교(내용 폭 글래스 알약) → 고지·만료 칩.
 * - "내 얼굴로 만들어 보기"는 잉크 알약이지만 메인 주 버튼(48px)보다 한 단계 작은 40px·내용 폭이다. 큰 화면(xl)은
 *   무대 오른쪽 아래 여백 넉넉한 글래스 카드(제목·설명 아래 왼쪽 정렬)에, 그보다 좁으면 맨 아래 가운데에 둔다(휴대폰도 내용 폭).
 *   같은 요소 하나를 격자 자리만 바꿔 링크는 하나뿐이다.
 */
export function SharedViewer({ token }: { token: string }) {
  const result = useSharedView(token)
  const [side, setSide] = useState<CompareSide>('after')
  const morphState = result.state === 'ready' ? result.view.morphState : null
  const weights = useMemo(() => (morphState ? viewerWeights(morphState.weights) : {}), [morphState])

  if (result.state === 'unavailable') {
    return (
      <Centered>
        <p className="type-lead text-ink">{UNAVAILABLE}</p>
        <TryCta />
      </Centered>
    )
  }
  if (result.state === 'error') {
    return (
      <Centered>
        <p className="type-lead text-ink">시안을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요</p>
      </Centered>
    )
  }
  if (result.state === 'loading') {
    return (
      <Frame>
        <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
          <span className="pf-loader" aria-hidden="true" />
        </div>
      </Frame>
    )
  }

  const { view } = result
  const eye = view.morphState.eyeEdit
  const eyeEdit = eye && view.eyeReview ? { state: eye, review: view.eyeReview } : undefined
  const expiry = formatShareExpiry(view.expiresAt)

  return (
    <Frame>
      <section
        aria-label="공유받은 시안"
        className={
          'relative isolate grid min-h-0 flex-1 grid-cols-1 justify-items-center gap-y-(--space-12) ' +
          'grid-rows-[auto_minmax(0,1fr)_auto_auto_auto_auto] px-(--space-16) pt-(--space-4) ' +
          'pb-[calc(var(--space-16)+env(safe-area-inset-bottom))] md:px-(--space-32) md:pb-(--space-24) ' +
          'xl:grid-cols-[minmax(0,1fr)_minmax(0,760px)_minmax(0,1fr)] xl:grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] xl:gap-x-(--space-32)'
        }
      >
        {/* 3D 뒤에만 번지는 은은한 빛(메인 체험 무대와 같다). 장식이라 누를 수 없다 */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_50%_at_50%_45%,var(--pf-stage-glow)_0%,transparent_70%)]"
        />

        <header className="flex flex-col items-center gap-(--space-4) text-center xl:col-start-2">
          {/* 공유한 사람이 직접 적은 이름만 보인다(계정 닉네임 아님, S15P31B204-843). 없으면 일반 제목 */}
          <h1 className="type-headline max-w-full break-words text-ink">
            {view.senderName ? (
              <>
                <span {...PRIVATE_TEXT}>{view.senderName}</span>님이 보낸 시안
              </>
            ) : (
              '공유받은 시안'
            )}
          </h1>
          <p className="type-label text-muted-soft">돌려 보며 원래 얼굴과 비교해 보세요</p>
        </header>

        <div className="relative h-full min-h-0 w-full xl:col-start-2">
          <FaceViewer
            enablePan
            meshUrl={view.meshUrl}
            rigUrl={view.rigUrl ?? undefined}
            weights={weights}
            pointStrokes={view.morphState.pointStrokes}
            eyeEdit={eyeEdit}
            hairUrl={view.hairAssetId ? hairUrlOf(view.hairAssetId) : null}
            layout="single"
            showing={side}
            view={FRONT_VIEW}
          />
        </div>

        <ViewerHints className="xl:col-start-2" />

        {/* 원래 얼굴·바꾼 얼굴 비교. 내용 폭만큼만 차지하고 무대 가운데에 맞춘다 */}
        <div className="glass flex max-w-full items-center rounded-full p-(--space-4) xl:col-start-2">
          <Segmented options={SIDES} value={side} onChange={setSide} label="비교" />
        </div>

        <div className="flex max-w-[52ch] flex-col items-center gap-(--space-8) text-center xl:col-start-2">
          {expiry ? (
            <p className="type-caption inline-flex items-center gap-(--space-6) rounded-full border border-hairline px-(--space-10) py-(--space-4) text-ink-2">
              <Icon name="Clock" size={14} className="shrink-0 text-muted-soft" />
              {expiry}에 링크가 닫혀요
            </p>
          ) : null}
          <p className="type-caption break-keep text-muted-soft">
            {SIMULATION_NOTICE} 의사 상담이 필요해요.
          </p>
        </div>

        {/* 큰 화면은 무대 오른쪽 아래 글래스 카드, 그보다 좁으면 맨 아래 가운데.
            카드는 버튼으로 꽉 채우지 않는다: 넉넉한 안쪽 여백에 글 → 작은 버튼을 왼쪽에 둔다 */}
        <aside
          aria-label="Preface 시작하기"
          className={
            'flex flex-col items-center gap-(--space-16) ' +
            'xl:glass xl:col-start-3 xl:row-span-4 xl:row-start-2 xl:w-full xl:max-w-[300px] xl:items-start xl:self-end xl:justify-self-center xl:rounded-(--pf-radius-xl) xl:p-(--space-24)'
          }
        >
          <div className="hidden flex-col gap-(--space-6) xl:flex">
            <p className="type-label text-ink">내 얼굴로도 만들어 보세요</p>
            <p className="type-caption break-keep text-ink-2">
              휴대폰 영상 하나로 내 얼굴을 3D로 만들고,{' '}
              {/* 가운뎃점 뒤에서 줄이 갈리지 않게 묶는다 */}
              <span className="whitespace-nowrap">코·눈·윤곽을</span> 직접 바꿔 볼 수 있어요.
            </p>
          </div>
          <TryCta />
        </aside>
      </section>
    </Frame>
  )
}

/** 로고(링크 아님) 아래에 화면을 채운다. 휴대폰에서도 한 화면(h-dvh) 안에 뷰어가 남은 높이를 다 쓴다 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <BrandBar link={false} />
      {children}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Frame>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-(--space-24) px-(--space-20) pb-(--space-40) text-center">
        {children}
      </div>
    </Frame>
  )
}

/**
 * 메인으로 가는 잉크 알약. 메인 주 버튼과 같은 색·모양이지만 한 단계 작다(40px·14px, 내용 폭).
 * 공유 화면의 주인공은 3D 시안이라 버튼이 카드나 화면 폭을 채우지 않게 Button(48px 고정) 대신 직접 그린다.
 * 화살표는 올리면 살짝 앞으로 간다(동작 줄이기 설정이면 움직이지 않는다).
 */
function TryCta() {
  return (
    <Link
      href="/"
      className={
        'group inline-flex h-10 shrink-0 items-center gap-(--space-6) rounded-full bg-ink pr-(--space-14) pl-(--space-18) ' +
        'text-[14px] leading-none font-medium tracking-[-0.01em] whitespace-nowrap text-on-ink ' +
        'transition-[transform,background-color] duration-(--pf-dur-press) ease-(--pf-ease-out) ' +
        'hover:bg-[oklch(0.28_0.01_286)] active:scale-[0.97] motion-reduce:active:scale-100'
      }
    >
      내 얼굴로 만들어 보기
      <Icon
        name="ArrowRight"
        size={16}
        className="shrink-0 transition-transform duration-(--pf-dur-ui) group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  )
}
