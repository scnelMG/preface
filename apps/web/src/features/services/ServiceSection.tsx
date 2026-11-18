'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { isFaceReadingEnabled } from '@/features/face-reading/flag'
import { useMemberNavigate } from '@/features/home/useMemberNavigate'
import { ASSET_BASE_URL } from '@/shared/config/env'
import { Button, type BadgeStatus, cx, Icon, Segmented, ServiceChoice } from '@/shared/ui'
import {
  matchesFilter,
  SERVICE_FILTERS,
  SERVICE_GROUPS,
  servicesOf,
  type ServiceFilter,
  type ServiceGroupId,
  type ServiceItem,
} from './catalog'

const DEFAULT_GROUP: ServiceGroupId = 'face'
const DEFAULT_FILTER: ServiceFilter = 'all'
const DEFAULT_SELECTED_ID = 'face-custom'

/**
 * 서비스 섹션 — Figma Wireframe v3.2 P3-17(283:2335). 메인(P3-06·13)과 `/services`가 같이 쓴다.
 *
 * - 탭: 얼굴 · 스타일 / AI 도우미 (숫자는 항목 수). 2026-10-31 모델 · 기록 탭은 뺐다
 * - 보기 필터: 전체 상태 / 이용 가능 / 예정 — 브라우저 기본 목록(select) 대신 작업실과 같은 알약 고르기(Segmented)
 * - AI 관상은 동의서 v2 시행 전 운영에서 꺼 둔다(face-reading/flag). 꺼진 곳에서는 예정으로 보인다
 * - 왼쪽 목록에서 고르면 오른쪽 상세가 바뀐다. 모바일은 목록 아래에 상세가 온다.
 *
 * ServiceChoice(디자인 시스템)는 링크라서 `?service=<id>`로 고른 항목을 주소에 남긴다.
 * 이 컴포넌트는 주소를 읽지 않고(동적 라우트 Suspense를 피하려고) 누르면 상태만 바꾼다.
 *
 * Figma 상세 위의 3D 와이어프레임 그림은 넣지 않고 자리만 둔다(사람 얼굴 그림을 저장소에 두지 않는다).
 *
 * cacheComponents가 켜져 있어 다른 화면에 다녀와도(Activity) 고른 탭·필터·항목이 남는다.
 * 돌아올 때마다 처음 모습(얼굴 · 스타일 / 전체 상태 / 3D 얼굴 커스텀)으로 되돌린다.
 */
export function ServiceSection({ className }: { className?: string }) {
  const [group, setGroup] = useState<ServiceGroupId>(DEFAULT_GROUP)
  const [filter, setFilter] = useState<ServiceFilter>(DEFAULT_FILTER)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_SELECTED_ID)
  const faceReading = useSyncExternalStore(
    noop,
    () => isFaceReadingEnabled(),
    () => false,
  )

  useEffect(() => {
    // 화면이 다시 보이면(Activity가 효과를 다시 돌린다) 처음 모습으로 되돌린다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroup(DEFAULT_GROUP)
    setFilter(DEFAULT_FILTER)
    setSelectedId(DEFAULT_SELECTED_ID)
  }, [])

  const items = servicesOf(group)
    .map((item) => (item.id === 'ai-face-reading' && !faceReading ? asPlanned(item) : item))
    .filter((item) => matchesFilter(item, filter))
  // 필터로 고른 항목이 빠지면 첫 항목을 보여 준다
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  return (
    <section aria-labelledby="services-title" className={cx('flex flex-col break-keep', className)}>
      <div className="flex flex-col gap-(--space-12) md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col">
          <h2
            id="services-title"
            className="text-[clamp(30px,3.4vw,48px)] leading-[1.15] font-[650] tracking-[-0.035em] text-text-ink"
          >
            다양한 가능성, 하나의 스튜디오.
          </h2>
        </div>
        <p className="text-[14px] leading-[1.6] text-muted md:text-right">
          지금 체험할 수 있는 기능부터
          <br className="hidden md:inline" /> 앞으로 만나볼 서비스까지 살펴보세요.
        </p>
      </div>

      <div className="mt-(--space-28) flex flex-col items-start gap-(--space-12) md:flex-row md:items-center md:justify-between">
        <Segmented
          label="서비스 분류"
          value={group}
          onChange={setGroup}
          options={SERVICE_GROUPS.map((item) => ({
            value: item.id,
            label: item.label,
            hint: servicesOf(item.id).length,
          }))}
        />
        <Segmented
          label="보기"
          mode="toggle"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={SERVICE_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>

      {/* 2026-10-31: 바깥 상자 없이 [목록 | 상세 흰 면]. 목록은 테두리 없이 고른 칸만 잉크 */}
      <div className="mt-(--space-24) flex flex-col gap-(--space-24) md:flex-row md:gap-(--space-32)">
        <div className="flex flex-col gap-(--space-2) md:w-[34%] md:shrink-0">
          {items.length === 0 ? (
            <p className="type-kr-caption-11-regular-lh20p9 px-(--space-14) py-(--space-18) text-text-sand">
              이 조건에 맞는 서비스가 없어요.
            </p>
          ) : (
            <ul className="flex flex-col gap-(--space-2)" aria-label="서비스 목록">
              {items.map((item) => (
                <li
                  key={item.id}
                  // ServiceChoice는 링크다. 같은 화면 안에서 고르기만 하므로 이동을 막는다
                  onClickCapture={(event) => {
                    event.preventDefault()
                    setSelectedId(item.id)
                  }}
                >
                  <ServiceChoice
                    icon={item.icon}
                    title={item.title}
                    status={item.status}
                    selected={item.id === selected?.id}
                    href={`?service=${item.id}`}
                  />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-auto flex items-center gap-(--space-7) px-(--space-12) pt-(--space-18) text-[12px] text-muted">
            <span aria-hidden className="size-1 rounded-full bg-text-muted" />
            현재 프리뷰 기준의 제공 상태입니다.
          </p>
        </div>
        {selected ? <ServiceDetail item={selected} /> : null}
      </div>

      <p className="mt-(--space-20) flex items-start gap-(--space-7) text-[12.5px] leading-[1.6] text-muted">
        <Icon name="Info" size={13} className="mt-(--space-2) shrink-0" />
        예정 기능은 현재 사용할 수 없어요. 공개 일정과 제공 범위는 준비 과정에서 달라질 수 있습니다.
      </p>
    </section>
  )
}

/** 디자인 시스템 Badge의 문구와 같다. 어두운 미리보기 위라 색만 다르게 그린다 */
const STATUS_LABEL: Record<BadgeStatus, string> = {
  available: '이용 가능',
  partial: '일부 체험',
  preview: '체험 가능',
  planned: '예정',
}

function ServiceDetail({ item }: { item: ServiceItem }) {
  const navigate = useMemberNavigate()
  const { action } = item

  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-(--pf-radius-xl) bg-surface shadow-(--pf-shadow-float)"
      aria-live="polite"
    >
      {/* 미리보기 자리. 지금 쓸 수 있는 3D 얼굴 커스텀은 실제 기본 모델 그림, 나머지는 아이콘만 둔다 */}
      <div className="relative flex h-64 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,var(--pf-surface),var(--pf-canvas-deep))]">
        <span className="absolute top-(--space-16) right-(--space-16) flex items-center gap-(--space-4) rounded-full bg-[color-mix(in_srgb,var(--pf-ink)_6%,transparent)] px-(--space-10) py-(--space-4) text-[11.5px] font-medium text-text-ink">
          <Icon name={item.status === 'planned' ? 'Clock' : 'Check'} size={10} />
          {STATUS_LABEL[item.status]}
        </span>
        {item.id === 'face-custom' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${ASSET_BASE_URL}/models/base-female.webp`}
            alt=""
            aria-hidden
            className="h-[86%] w-auto translate-y-[7%] object-contain"
          />
        ) : (
          <Icon name={item.icon} weight="light" size={56} className="text-text-muted" />
        )}
      </div>

      <div className="flex flex-col px-(--space-28) pt-(--space-24) pb-(--space-24)">
        {/* 제목 위 작은 머리글(eyebrow) 대신 제목 아래 한 줄 소개로 둔다(2026-10-30) */}
        <h3 className="text-2xl font-medium tracking-tight text-text-ink">{item.title}</h3>
        <p className="type-kr-body-13-regular-lh16p9 mt-(--space-6) text-text-ink">{item.kicker}</p>
        <p className="mt-(--space-12) max-w-xl text-[14px] leading-relaxed text-text-paragraph">
          {item.description}
        </p>
        {item.options.length > 0 ? (
          <ul className="mt-(--space-16) flex flex-wrap gap-(--space-7)">
            {item.options.map((option) => (
              <li
                key={option}
                className="rounded-full bg-[color-mix(in_srgb,var(--pf-ink)_5%,transparent)] px-(--space-10) py-(--space-5) text-[12px] leading-[14px] text-text-ink"
              >
                {option}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-(--space-20)">
          {action ? (
            action.memberOnly ? (
              <Button variant="violet" onClick={() => navigate(action.href)}>
                {action.label}
              </Button>
            ) : (
              <Button variant="violet" href={action.href}>
                {action.label}
              </Button>
            )
          ) : (
            <p className="type-kr-caption-11-regular-lh14p3 flex items-center gap-(--space-6) text-text-stone">
              <Icon name="Clock" size={14} />
              공개 예정이에요.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

const noop = () => () => {}

/** 지금 이 환경에서 쓸 수 없는 항목을 예정으로 보인다(이동 버튼 없음) */
function asPlanned(item: ServiceItem): ServiceItem {
  return { ...item, status: 'planned', kicker: '준비 중인 기능이에요.', action: undefined }
}
