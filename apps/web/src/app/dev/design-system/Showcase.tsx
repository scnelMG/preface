'use client'

import { useState, type ReactNode } from 'react'
import { COLOR_TOKENS, STATUS_DANGER, TYPE_TOKENS } from '@/shared/design/tokens'
import {
  Badge,
  Button,
  Checkbox,
  Eyebrow,
  Footer,
  Header,
  Icon,
  ICON_NAMES,
  iconWeights,
  LabServiceRow,
  Modal,
  ModelTile,
  RecordCard,
  Select,
  ServiceChoice,
  SliderRow,
  StatusChip,
  Tab,
  TabList,
  Tag,
  Textarea,
  TextField,
  toast,
} from '@/shared/ui'

function Section({
  title,
  figma,
  children,
}: {
  title: string
  figma: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-line-default py-(--space-32)">
      <h2 className="type-kr-heading-15-medium-ls-0p5-lh19p5">{title}</h2>
      <p className="type-kr-caption-10-regular-lh13 mt-(--space-4) text-text-muted">
        Figma {figma}
      </p>
      <div className="mt-(--space-20)">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-(--space-16)">{children}</div>
}

export function Showcase() {
  const [countTab, setCountTab] = useState('face')
  const [stackTab, setStackTab] = useState('face')
  const [pillTab, setPillTab] = useState('45')
  const [barTab, setBarTab] = useState('head')
  const [iconTab, setIconTab] = useState('consult')
  const [checked, setChecked] = useState(true)
  const [bridge, setBridge] = useState(0.2)
  const [modalOpen, setModalOpen] = useState(false)
  const [tile, setTile] = useState('01')
  const [labOpen, setLabOpen] = useState('face')

  return (
    <main className="mx-auto w-full max-w-page px-(--space-20) py-(--space-40)">
      <Eyebrow>DESIGN SYSTEM · FOUNDATIONS V3</Eyebrow>
      <h1 className="type-kr-title-22-medium-ls-1-lh28p6 mt-(--space-10)">
        디자인 시스템 1 — 확인용
      </h1>
      <p className="type-kr-body-12-regular-lh22p2 mt-(--space-8) text-text-body">
        Figma `Wireframe v3.2 최종` › `Foundations · v3`와 나란히 놓고 비교한다. 운영 빌드에서는
        404다.
      </p>

      <Section
        title={`색 ${COLOR_TOKENS.length}개 + status/danger`}
        figma="Foundations · v3 › Color"
      >
        <div className="grid grid-cols-2 gap-(--space-12) md:grid-cols-4">
          {[...COLOR_TOKENS, STATUS_DANGER].map((c) => (
            <div key={c.name} className="flex items-center gap-(--space-10)">
              <span
                className="size-[32px] shrink-0 rounded-6 border border-line-default"
                style={{ background: `var(--${c.name})` }}
              />
              <span className="type-en-caption-10-regular-lh13">
                {c.name}
                <br />
                <span className="text-text-muted">{c.value}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`타입 ${TYPE_TOKENS.length}개`} figma="Foundations · v3 › Type">
        <ul className="space-y-(--space-10)">
          {TYPE_TOKENS.map((t) => (
            <li
              key={t.className}
              className="flex flex-col gap-(--space-2) md:flex-row md:items-baseline md:gap-(--space-24)"
            >
              <span className="type-en-caption-9-regular-lh11p7 w-[320px] shrink-0 text-text-muted">
                {t.figma}
              </span>
              <span className={t.className}>얼굴 스타일 Preface 2026</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="아이콘" figma="Foundations · v3 › Icons (63) + v3/Icon/Bell-regular">
        <div className="grid grid-cols-3 gap-(--space-12) md:grid-cols-6">
          {ICON_NAMES.flatMap((name) =>
            iconWeights(name).map((weight) => (
              <div key={`${name}-${weight}`} className="flex items-center gap-(--space-8)">
                <Icon name={name} weight={weight} />
                <span className="type-en-caption-9-regular-lh11p7">
                  {name}
                  <br />
                  <span className="text-text-muted">{weight}</span>
                </span>
              </div>
            )),
          )}
        </div>
      </Section>

      <Section title="Button" figma="v3/Button">
        <div className="space-y-(--space-16)">
          <Row>
            <Button variant="primary">체험하기</Button>
            <Button variant="primary" layout="inline">
              체험하기
            </Button>
            <Button variant="ink">데모로 로그인하기</Button>
            <Button variant="ink" layout="inline">
              데모로 로그인하기
            </Button>
            <Button variant="violet">코 조절 체험하기</Button>
          </Row>
          <Row>
            <Button variant="secondary">확인했어요</Button>
            <Button variant="secondary" layout="inline">
              확인했어요
            </Button>
            <Button variant="secondary" layout="icon-first">
              로그아웃
            </Button>
            <Button variant="danger">데모로 로그인하기</Button>
          </Row>
          <Row>
            <Button variant="quiet">전체 서비스와 예정 기능</Button>
            <div className="w-[232px]">
              <Button variant="quiet" layout="spread">
                나의 머리 추가하기
              </Button>
            </div>
            <Button variant="text">로그인</Button>
            <Button variant="text" layout="inline">
              로그인
            </Button>
            <Button variant="icon" aria-label="닫기" />
            <Button variant="ink" disabled>
              비활성
            </Button>
          </Row>
        </div>
      </Section>

      <Section
        title="Badge · Tag · Eyebrow · StatusChip"
        figma="v3/Badge · v3/Tag · v3/Eyebrow · v3/StatusChip"
      >
        <Row>
          <Badge status="available" />
          <Badge status="partial" />
          <Badge status="planned" />
          <Badge status="preview" />
          <Tag>QUICK START</Tag>
          <Eyebrow>YOUR FACE. YOUR PERSPECTIVE.</Eyebrow>
          <Eyebrow dot={false}>A LITTLE CHANGE. A DIFFERENT VIEW.</Eyebrow>
          <StatusChip done={false} />
          <StatusChip done />
        </Row>
      </Section>

      <Section title="Tab" figma="v3/Tab">
        <div className="space-y-(--space-24)">
          <TabList
            variant="count"
            value={countTab}
            onChange={setCountTab}
            aria-label="Count"
            className="gap-(--space-24)"
          >
            <Tab value="face" count={5}>
              얼굴 · 스타일
            </Tab>
            <Tab value="ai" count={7}>
              AI 도우미
            </Tab>
          </TabList>
          <TabList
            variant="stack"
            value={stackTab}
            onChange={setStackTab}
            aria-label="Stack"
            className="gap-(--space-24)"
          >
            <Tab value="face" count={5}>
              얼굴 · 스타일
            </Tab>
            <Tab value="ai" count={7}>
              AI 도우미
            </Tab>
          </TabList>
          <TabList variant="pill" value={pillTab} onChange={setPillTab} aria-label="Pill">
            <Tab value="front">정면</Tab>
            <Tab value="45">45°</Tab>
          </TabList>
          <TabList
            variant="bar"
            value={barTab}
            onChange={setBarTab}
            aria-label="Bar"
            className="gap-(--space-24)"
          >
            <Tab value="head" count="03">
              머리 선택
            </Tab>
            <Tab value="recent" count="12">
              최근 기록
            </Tab>
          </TabList>
          <TabList variant="icon" value={iconTab} onChange={setIconTab} aria-label="Icon">
            <Tab value="consult" icon="ChatCircleText">
              상담
            </Tab>
            <Tab value="direct" icon="SlidersHorizontal">
              직접 조절
            </Tab>
          </TabList>
        </div>
      </Section>

      <Section title="Input · Checkbox" figma="v3/Input · v3/Checkbox">
        <Row>
          <Select aria-label="상태" defaultValue="all">
            <option value="all">전체 상태</option>
            <option value="done">완료</option>
          </Select>
          <div className="w-[202px]">
            <TextField aria-label="시안 검색" placeholder="시안 이름으로 검색" />
          </div>
          <div className="w-[320px]">
            <Textarea aria-label="변경 요청" placeholder="예: 콧대를 조금 높이고 싶어요" />
          </div>
          <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)}>
            <span className="type-kr-body-12-regular-lh15p6">약관에 동의해요</span>
          </Checkbox>
          <Checkbox disabled>
            <span className="type-kr-body-12-regular-lh15p6">비활성</span>
          </Checkbox>
        </Row>
      </Section>

      <Section title="SliderRow" figma="v3/SliderRow">
        <div className="w-[320px]">
          <SliderRow label="콧대 높이" value={bridge} min={-0.5} max={0.5} onChange={setBridge} />
        </div>
      </Section>

      <Section
        title="Header · Footer"
        figma="v3/Header · v3/Footer (화면 폭 768px 미만이면 Mobile)"
      >
        <div className="space-y-(--space-24) bg-bg-paper">
          <Header
            active="main"
            member={null}
            onLoginClick={() => setModalOpen(true)}
            onLogout={() => {}}
          />
          <Header
            active="studio"
            member={{ nickname: '민서' }}
            unread
            onLoginClick={() => {}}
            onLogout={() => toast('로그아웃했어요')}
          />
          <Footer />
        </div>
      </Section>

      <Section title="Modal · Toast" figma="v3/Modal · v3/Toast">
        <Row>
          <Button variant="ink" onClick={() => setModalOpen(true)}>
            모달 열기
          </Button>
          <Button variant="secondary" onClick={() => toast('로컬 데모로 로그인했어요.')}>
            토스트 띄우기
          </Button>
          <Button
            variant="secondary"
            trailingIcon="ArrowCounterClockwise"
            onClick={() =>
              toast('초기화했어요.', {
                action: { label: '되돌리기', onClick: () => toast('되돌렸어요.') },
              })
            }
          >
            되돌리기 토스트
          </Button>
        </Row>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          eyebrow="PREFACE STUDIO"
          title="나만의 공간을 열어보세요."
        >
          <p className="type-kr-body-13-regular-lh16p9 leading-[25px] text-text-paragraph">
            나의 모델과 시안을 한곳에 모으고, 지난 작업을 이어가세요.
          </p>
          <p className="type-kr-caption-10-regular-lh13 mt-(--space-16) text-text-muted">
            (로그인 버튼은 -274가 이 자리에 넣는다)
          </p>
        </Modal>
      </Section>

      <Section
        title="카드"
        figma="v3/Card/RecordCard · ServiceChoice · ModelTile · v3/LabServiceRow"
      >
        <div className="grid gap-(--space-24) md:grid-cols-2">
          <div className="w-full max-w-[411px]">
            <RecordCard
              href="/simulations/demo"
              category="밸런스 스터디"
              title="밸런스 스터디 원본 비교"
              updatedAt="2026-10-21T07:01:00Z"
              onDelete={() => toast('삭제했어요.')}
            />
          </div>
          <div className="flex flex-col gap-(--space-8)">
            <ServiceChoice
              icon="User"
              title="3D 얼굴 커스텀"
              subtitle="FACE CUSTOMIZATION"
              status="partial"
              selected
              href="/lab"
            />
            <ServiceChoice
              icon="Scissors"
              title="헤어 스타일"
              subtitle="HAIR STYLING"
              status="planned"
              href="/services"
            />
          </div>
          <div className="grid grid-cols-3 gap-(--space-16)">
            {[
              { id: '01', title: '오리지널', subtitle: '공개 샘플' },
              { id: '02', title: '라인 스터디', subtitle: '비교 프리셋' },
            ].map((m) => (
              <ModelTile
                key={m.id}
                kind={tile === m.id ? 'selected' : 'default'}
                index={m.id}
                title={m.title}
                subtitle={m.subtitle}
                onClick={() => setTile(m.id)}
              />
            ))}
            <ModelTile
              kind="add"
              title="새로운 머리"
              subtitle="나의 모델을 추가하세요."
              onClick={() => toast('머리 추가는 -155에서 연결한다.')}
            />
          </div>
          <div className="w-[320px]">
            <LabServiceRow
              icon="User"
              label="3D 얼굴 커스텀"
              status="partial"
              expanded={labOpen === 'face'}
              onClick={() => setLabOpen('face')}
            />
            <LabServiceRow
              icon="Scissors"
              label="헤어 스타일"
              status="planned"
              expanded={labOpen === 'hair'}
              onClick={() => setLabOpen('hair')}
            />
          </div>
        </div>
      </Section>
    </main>
  )
}
