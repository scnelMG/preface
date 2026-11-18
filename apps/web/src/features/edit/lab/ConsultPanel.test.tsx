import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CONTACT } from '@/features/legal/facts'
import { api } from '@/shared/api/client'
import { newEyeState } from '../eyes/state'
import { SAMPLE_NOSE_CATALOG } from '../noseControls'
import { SAMPLE_CONTOUR_PART } from '../contourControls'
import type { MorphParameterCatalog } from '../types'
import { ConsultPanel, sliderPartsNotice, visibleApplyRows } from './ConsultPanel'
import type { ChatItem, Consult } from './useConsult'
import { measureFaceProfile, type FaceProfile } from './faceProfile'

function consult(items: ChatItem[]): Consult {
  return {
    items,
    loading: false,
    busy: false,
    error: null,
    send: vi.fn().mockResolvedValue(true),
  } as Consult
}

function savedReply(id: string, request: string, profileSection: string, content = ''): ChatItem[] {
  return [
    { id: id + '-user', role: 'user', content: request },
    { id, role: 'assistant', content, profileSection },
  ]
}

const comparisonProfile: FaceProfile = {
  overall: [],
  eyes: [],
  lips: [],
  lower: [
    { id: 'jaw-width-face-width', label: '턱 너비', value: '0.73배', method: '양옆을 쟀어요.' },
  ],
  side: [
    {
      id: 'upper-lip-profile-line',
      label: '윗입술 기준점',
      value: '-5.5%',
      method: '코끝과 턱끝을 이었어요.',
    },
  ],
}

it.each([
  '쌍꺼풀은 그대로 두고 다음엔 뭘 바꿔보면 좋을까요?',
  '쌍꺼풀은 마음에 들어요. 어디를 더 손보면 좋을까요?',
])('쌍꺼풀을 유지하며 다음 조절을 제안한다: %s', async (question) => {
  const chat = consult([])
  const view = vi.fn()
  const apply = vi.fn()
  const props = {
    consult: { ...chat, applyComparison: apply },
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: comparisonProfile,
    hasAppliedEyelids: true,
    supportedSliderCodes: ['contour.chin_projection', 'contour.jaw_angle'],
    savedWeights: {
      'contour.chin_projection': SAMPLE_CONTOUR_PART.items.find(
        ({ code }) => code === 'contour.chin_projection',
      )!.max,
    },
    modeSwitch: { stateVersion: 5, revision: 'saved-morph-5' },
    onComparisonView: view,
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(question, {
      exampleId: 'next-adjustment',
      profileSection: 'next:chinProjection,jawAngle:fold',
      recommendationMeasurements: {
        'upper-lip-profile-line': -0.055,
        'jaw-width-face-width': 0.73,
      },
    }),
  )
  const advice = savedReply('advice', question, 'next:chinProjection,jawAngle:fold')
  rerender(<ConsultPanel {...props} consult={{ ...props.consult, items: advice }} />)
  expect(screen.getByText(/^적용한 쌍꺼풀을 유지하면서 비교/)).toBeVisible()
  const list = screen.getByRole('list', { name: '다음 조절 후보' })
  const chinOption = within(list).getByLabelText('턱끝 앞뒤 비교 옵션')
  expect(within(list).getByText('윤곽-턱끝 뒤로')).toBeVisible()
  expect(within(list).getByText('정면 - 아래턱 윤곽의 폭')).toBeVisible()
  expect(within(list).getByText('턱끝 뒤로 비교')).not.toBeVisible()
  expect(within(list).queryByText('사각턱 좁게 비교')).not.toBeInTheDocument()
  fireEvent.click(chinOption)
  expect(within(list).getByText('턱끝 뒤로 비교')).toBeVisible()
  expect(within(list).queryByText('사각턱 좁게 비교')).not.toBeInTheDocument()
  const chatArea = screen.getByRole('region', { name: '상담 대화' })
  const candidate = chinOption.closest('details')!
  vi.spyOn(chatArea, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: 146 }))
  vi.spyOn(candidate, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ y: 100 }))
  vi.spyOn(
    screen.getByRole('button', { name: '턱끝 뒤로 비교' }),
    'getBoundingClientRect',
  ).mockReturnValue(DOMRect.fromRect({ y: 150, height: 44 }))
  fireEvent(candidate, new Event('toggle'))
  expect(chatArea.scrollTop).toBe(48)
  expect(screen.getByText('윗입술 기준점은 코끝과 턱끝을 이은 선보다 뒤에 있어요.')).toBeVisible()
  expect(screen.getByText('턱끝을 뒤로 조금 옮겨 보세요.')).toBeVisible()
  fireEvent.click(screen.getByLabelText('턱끝 앞뒤 근거 보기'))
  expect(screen.getByText('코끝과 턱끝을 이었어요.')).toBeVisible()
  expect(screen.getByText('-5.5%')).toBeVisible()
  expect(
    screen.getByRole('link', { name: 'Ricketts · 입술과 측면 기준선 (1968)' }),
  ).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/5238879/')
  expect(screen.queryByRole('button', { name: '턱끝 앞으로 비교' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '턱끝 뒤로 비교' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith('턱끝을 조금 뒤로 넣어서 보여줘', {
      exampleId: 'consult-preview',
      comparisonTarget: { code: 'contour.chin_projection', value: 0.9 },
      comparisonAnchorId: 'advice:chinProjection',
    }),
  )
  expect(view).toHaveBeenCalledWith('side')
  expect(apply).not.toHaveBeenCalled()

  const cancelComparison = vi.fn()
  const items: ChatItem[] = [
    ...advice,
    { id: 'preview', role: 'assistant', content: '비교 안내' },
    { id: 'newer', role: 'assistant', content: '나중 답변' },
  ]
  rerender(
    <ConsultPanel
      {...props}
      consult={{
        ...props.consult,
        items,
        cancelComparison,
        comparison: {
          simulationId: 'sim',
          messageId: 'preview',
          requestId: 'request',
          anchorId: 'advice:chinProjection',
          result: { stateVersion: 5, summary: '턱끝 앞뒤' } as NonNullable<
            Consult['comparison']
          >['result'],
        },
      }}
    />,
  )
  const recommendation = screen.getByLabelText('턱끝 앞뒤 비교 옵션').closest('li')!
  const other = screen.getByLabelText('사각턱 비교 옵션').closest('li')!
  expect(within(recommendation).getByRole('region', { name: '3D 비교' })).toBeVisible()
  expect(within(other).queryByRole('region', { name: '3D 비교' })).not.toBeInTheDocument()
  const reply = screen.getByText(question).closest('li')!.nextElementSibling!
  expect(reply.nextElementSibling).toHaveTextContent('비교 안내')
  fireEvent.click(within(recommendation).getByRole('button', { name: '비교 닫기' }))
  expect(cancelComparison).toHaveBeenCalledOnce()
  expect(apply).not.toHaveBeenCalled()
})

it.each([
  ['턱끝은 그대로 두고, 옆모습에서 다음엔 어디를 손보면 좋을까요?', '', 'next:projection'],
  ['옆모습에서 다음엔 어디를 손보면 좋을까요?', '턱 끝', 'next:projection'],
  ['턱끝과 코끝은 건드리지 말고, 다음엔 어디를 손보면 좋을까요?', '', 'next:jawAngle'],
])('다음 조절에서 유지 조건을 뺀다: %s', async (question, keep, section) => {
  const chat = consult(
    keep ? [{ id: 'goal', role: 'user', content: '상담 목표: 옆모습 / 유지할 부위: ' + keep }] : [],
  )
  render(
    <ConsultPanel
      consult={chat}
      catalog={{
        ...SAMPLE_NOSE_CATALOG,
        parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART],
      }}
      faceRatioAvailable
      faceProfile={comparisonProfile}
      savedWeights={{}}
      supportedSliderCodes={['nose.tip_projection', 'contour.chin_projection', 'contour.jaw_angle']}
    />,
  )
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(question, {
      exampleId: 'next-adjustment',
      profileSection: section,
      recommendationMeasurements:
        section === 'next:jawAngle'
          ? { 'jaw-width-face-width': 0.73 }
          : { 'upper-lip-profile-line': -0.055 },
    }),
  )
})

it('슬라이더에서 상담으로 돌아오면 선택을 지우지 않고 기존 추천을 비교한다', () => {
  const chat = consult(
    savedReply('advice', '다음 조절 추천받기', 'next:chinProjection,jawAngle:fold'),
  )
  const openSlider = vi.fn()
  const clearDirectControl = vi.fn()
  const props = {
    consult: chat,
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceProfile: comparisonProfile,
    supportedSliderCodes: ['contour.chin_projection', 'contour.jaw_angle'],
    savedWeights: {},
    onComparisonView: vi.fn(),
    onOpenSlider: openSlider,
    onClearDirectControl: clearDirectControl,
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.click(screen.getByLabelText('사각턱 비교 옵션'))
  fireEvent.click(screen.getByRole('button', { name: '사각턱 직접 조절하기' }))
  expect(openSlider).toHaveBeenCalledWith('contour.jaw_angle', {})

  rerender(
    <ConsultPanel
      {...props}
      directControl={{ code: 'contour.jaw_angle', label: '사각턱', stateVersion: 5 }}
    />,
  )
  expect(screen.getByText(/선택한 조절 · 사각턱/)).toBeVisible()
  fireEvent.click(screen.getByLabelText('턱끝 앞뒤 비교 옵션'))
  fireEvent.click(screen.getByRole('button', { name: '턱끝 뒤로 비교' }))
  expect(chat.send).toHaveBeenCalledExactlyOnceWith('턱끝을 조금 뒤로 넣어서 보여줘', {
    exampleId: 'consult-preview',
    comparisonTarget: { code: 'contour.chin_projection', value: -0.1 },
    comparisonAnchorId: 'advice:chinProjection',
  })
  expect(clearDirectControl).not.toHaveBeenCalled()
})

it('사각턱이 선택돼 있어도 전체 추천을 요청하고 접힌 각 카드에 모델 설명을 연결한다', () => {
  const question = '지금 시안에서 어디부터 바꿔보면 좋을까요?'
  const chat = consult([])
  const jaw =
    '정면에서 아래턱 양옆이 도드라져 보여요. 사각턱 폭을 살짝 좁혀 턱선이 모이는 변화를 살펴보세요.'
  const chin =
    '옆모습에서 입매가 코끝과 턱끝을 이은 선보다 뒤에 있어요. 턱끝을 살짝 뒤로 옮기면 입매와 이어지는 선이 달라져요.'
  const props = {
    consult: chat,
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: comparisonProfile,
    savedWeights: {},
    directControl: { code: 'contour.jaw_angle', label: '사각턱', stateVersion: 5 },
    supportedSliderCodes: ['contour.chin_projection', 'contour.jaw_angle'],
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: question },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenCalledExactlyOnceWith(question, {
    exampleId: 'next-adjustment',
    profileSection: 'next:chinProjection,jawAngle',
    recommendationMeasurements: { 'upper-lip-profile-line': -0.055, 'jaw-width-face-width': 0.73 },
  })
  for (const openEndedQuestion of [
    '지금 얼굴에서 다음으로 손봐볼 만한 곳을 추천해 주세요.',
    '나 쌍커풀 했는데 더 뭐하면 좋을까?',
    '나 쌍꺼풀했는데, 그다음 뭐할까? 추천해봐',
    '쌍꺼풀 바꿨어. 그 다음 뭐 바꿀지 모르겠어',
    '나 쌍꺼풀 바꿨는데, 그 다음에 뭐 바꿀지 모르겠어. 추천점',
    '코를 조절했어요. 그다음엔 뭘 해 볼까요?',
    '편집했는데 그 뒤에는 뭘 조절할지 모르겠어요',
    '뭘 바꾸면 인상이 조금 달라질까요?',
  ]) {
    fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
      target: { value: openEndedQuestion },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(chat.send).toHaveBeenLastCalledWith(openEndedQuestion, {
      exampleId: 'next-adjustment',
      profileSection: 'next:chinProjection,jawAngle',
      recommendationMeasurements: {
        'upper-lip-profile-line': -0.055,
        'jaw-width-face-width': 0.73,
      },
    })
  }
  const selectedQuestion = '여기는 어느 방향으로 조절하면 좋을까요?'
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: selectedQuestion },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenLastCalledWith(selectedQuestion, {
    directControl: { code: 'contour.jaw_angle', stateVersion: 5 },
  })

  rerender(
    <ConsultPanel
      {...props}
      consult={consult(
        savedReply(
          'next',
          question,
          'next:jawAngle,chinProjection:measured:-1/0.73/0.71,-1/-0.055/-0.04:narrative',
          [jaw, chin].join('\n'),
        ),
      )}
    />,
  )
  const list = screen.getByRole('list', { name: '다음 조절 후보' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  expect(within(list).getByText(jaw.split('. ')[0] + '.')).not.toBeVisible()
  expect(within(list).getByText(chin.split('. ')[0] + '.')).not.toBeVisible()
  fireEvent.click(within(list).getByLabelText('사각턱 비교 옵션'))
  expect(within(list).getByText(jaw.split('. ')[0] + '.')).toBeVisible()
  expect(within(list).getByText('사각턱 폭을 살짝 좁혀', { selector: 'strong' })).toBeVisible()
  expect(within(list).queryByText('사각턱 폭을 살짝 좁혀 보세요.')).not.toBeInTheDocument()
  fireEvent.click(within(list).getByLabelText('턱끝 앞뒤 비교 옵션'))
  expect(within(list).getByText(chin.split('. ')[0] + '.')).toBeVisible()
})

it('정면 질문은 정면 측정 근거만 사용하고 근거가 없으면 다른 각도를 제안하지 않는다', async () => {
  const chat = consult([])
  const props = {
    consult: chat,
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: comparisonProfile,
    savedWeights: {},
    supportedSliderCodes: ['contour.chin_projection', 'contour.jaw_angle'],
    onComparisonView: vi.fn(),
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '정면에서는 어디를 더 손보면 좋을까요?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith('정면에서는 어디를 더 손보면 좋을까요?', {
      exampleId: 'next-adjustment',
      profileSection: 'next:jawAngle',
      recommendationMeasurements: { 'jaw-width-face-width': 0.73 },
    }),
  )
  const persisted = savedReply('front', '정면에서는 어디를 더 손보면 좋을까요?', 'next:jawAngle')
  rerender(<ConsultPanel {...props} consult={{ ...chat, items: persisted }} />)
  expect(screen.getByText('정면 - 아래턱 윤곽의 폭')).toBeVisible()
  fireEvent.click(screen.getByLabelText('사각턱 비교 옵션'))
  expect(screen.getByText('아래턱 폭은 얼굴 폭의 약 73%예요.')).toBeVisible()
  expect(
    screen.queryByText('정면에서 턱선이 얼마나 모이거나 넓어 보이는지 비교해요.'),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText('턱선을 더 모아 보려면 좁게, 폭을 살리려면 넓게 움직여 보세요.'),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: /사각턱.*비교/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('사각턱 근거 보기'))
  expect(screen.getByText('양옆을 쟀어요.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'FaceBase · 3D 얼굴 표면 기준점' })).toBeVisible()

  rerender(<ConsultPanel {...props} faceProfile={{ ...comparisonProfile, lower: [] }} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '어디부터 바꿔보면 좋을까요?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenLastCalledWith('어디부터 바꿔보면 좋을까요?', {
    exampleId: 'next-adjustment',
    profileSection: 'next:chinProjection',
    recommendationMeasurements: { 'upper-lip-profile-line': -0.055 },
  })
})

it('현재 형상의 시험값을 보내고 저장된 추천에는 당시 근거와 슬라이더만 표시한다', async () => {
  const question = '어디부터 바꿔보면 좋을까요?'
  const chat = consult([])
  const openSlider = vi.fn()
  const measureTrial = vi
    .fn()
    .mockReturnValueOnce({
      ...comparisonProfile,
      side: [{ ...comparisonProfile.side[0], value: '-3.0%' }],
    })
    .mockReturnValue(null)
  const props = {
    consult: chat,
    catalog: SAMPLE_NOSE_CATALOG,
    faceRatioAvailable: true,
    faceProfile: comparisonProfile,
    supportedSliderCodes: ['nose.tip_projection'],
    savedWeights: {},
    modeSwitch: { stateVersion: 5, revision: 'saved-morph-5' },
    onOpenSlider: openSlider,
    measureTrial,
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.click(screen.getByRole('button', { name: question }))
  expect(chat.send).toHaveBeenCalledWith(question, {
    exampleId: 'next-adjustment',
    profileSection: 'next:projection',
    recommendationMeasurements: {
      'trial-version': 1,
      'trial-state': 5,
      'upper-lip-profile-line': -0.055,
      'projection:down': -0.03,
    },
  })
  const explanation = '옆에서 코끝이 덜 도드라져 보여요.'
  rerender(
    <ConsultPanel
      {...props}
      consult={consult(
        savedReply('stored', question, 'next:projection:measured:-1/-0.055/-0.03', explanation),
      )}
    />,
  )
  fireEvent.click(screen.getByLabelText('코끝 앞뒤 비교 옵션'))
  expect(screen.getByText(explanation)).toBeVisible()
  const suggestion = screen.getByText('코끝을 살짝 뒤로', { selector: 'strong' }).closest('dd')
  expect(suggestion).toHaveTextContent('코끝을 살짝 뒤로 옮겨 보세요.')
  expect(suggestion?.nextElementSibling).toHaveTextContent(explanation)
  expect(screen.queryByRole('button', { name: '코끝 뒤로 비교' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('코끝 앞뒤 근거 보기'))
  expect(screen.getByText('-5.5% → -3%')).toBeVisible()
  measureTrial.mockReturnValue({
    ...comparisonProfile,
    side: [{ ...comparisonProfile.side[0], value: '-3.0%' }],
  })
  fireEvent.click(screen.getByRole('button', { name: '코끝 직접 조절하기' }))
  expect(openSlider).toHaveBeenLastCalledWith('nose.tip_projection', {
    preview: {
      changes: [expect.objectContaining({ code: 'nose.tip_projection' })],
    },
  })
  expect(chat.send).toHaveBeenCalledTimes(1)
  measureTrial.mockReturnValue(null)
  fireEvent.click(screen.getByRole('button', { name: '코끝 직접 조절하기' }))
  expect(openSlider).toHaveBeenLastCalledWith('nose.tip_projection', {})

  rerender(
    <ConsultPanel
      {...props}
      consult={consult(
        savedReply(
          'legacy',
          question,
          'next:projection:measured:-1/-0.055/-0.03',
          '옆에서 down으로 옮기면 기준선이 가까워 보여요.',
        ),
      )}
    />,
  )
  fireEvent.click(screen.getByLabelText('코끝 앞뒤 비교 옵션'))
  expect(screen.queryByText(/down/)).not.toBeInTheDocument()
  expect(screen.getByText('옆에서 봤을 때 코끝이 덜 도드라져 보여요.')).toBeVisible()
})

it('표시값이 같은 사각턱 시험도 반올림 전 변화를 추천에 보내고 실제 차이만 표시한다', () => {
  const sample = (halfWidth: number) =>
    measureFaceProfile(
      new Map([
        [234, [-50, 5, 0]],
        [454, [50, 5, 0]],
        [172, [-halfWidth, 0, 0]],
        [397, [halfWidth, 0, 0]],
      ]),
    )
  const before = sample(40.1)
  const after = sample(39.8)
  expect(before?.lower[0]?.value).toBe('0.80배')
  expect(after?.lower[0]?.value).toBe('0.80배')
  const question = '어디부터 바꿔보면 좋을까요?'
  const chat = consult([])
  const props = {
    consult: chat,
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: before,
    supportedSliderCodes: ['contour.jaw_angle'],
    savedWeights: {},
    modeSwitch: { stateVersion: 5, revision: 'saved-morph-5' },
    measureTrial: vi.fn().mockReturnValueOnce(after).mockReturnValue(before),
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.click(screen.getByRole('button', { name: question }))
  expect(chat.send).toHaveBeenCalledOnce()
  const input = vi.mocked(chat.send).mock.calls[0][1]?.recommendationMeasurements
  expect(input?.['jaw-width-face-width']).toBeCloseTo(0.802)
  expect(input?.['jawAngle:down']).toBeCloseTo(0.796)
  expect(input).not.toHaveProperty('jawAngle:up')

  rerender(
    <ConsultPanel
      {...props}
      consult={consult(
        savedReply(
          'jaw',
          question,
          'next:jawAngle:measured:-1/0.802/0.796',
          '정면에서 아래턱 폭이 다소 좁아 보여요.',
        ),
      )}
    />,
  )
  fireEvent.click(screen.getByLabelText('사각턱 비교 옵션'))
  fireEvent.click(screen.getByLabelText('사각턱 근거 보기'))
  expect(
    screen.getByText('사각턱 폭을 살짝 좁혀', { selector: 'strong' }).closest('dd'),
  ).toHaveTextContent('사각턱 폭을 살짝 좁혀 보세요.')
  expect(screen.getByText('80.2% → 79.6%')).toBeVisible()
})

it('추천에 기록된 조절이 잠겨도 설명은 남고 비교 동작만 숨긴다', () => {
  const openSlider = vi.fn()
  const props = {
    consult: consult(savedReply('jaw', '다음 조절 추천받기', 'next:jawAngle')),
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: comparisonProfile,
    savedWeights: {},
    onComparisonView: vi.fn(),
    onOpenSlider: openSlider,
  }
  const { rerender } = render(<ConsultPanel {...props} supportedSliderCodes={[]} />)
  fireEvent.click(screen.getByLabelText('사각턱 비교 옵션'))
  fireEvent.click(screen.getByLabelText('사각턱 근거 보기'))
  expect(screen.getByText('양옆을 쟀어요.')).toBeVisible()
  expect(screen.queryByText('조절 방향')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /사각턱.*비교/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '사각턱 직접 조절하기' })).toBeDisabled()
  const max = SAMPLE_CONTOUR_PART.items.find(({ code }) => code === 'contour.jaw_angle')!.max
  rerender(
    <ConsultPanel
      {...props}
      supportedSliderCodes={['contour.jaw_angle']}
      savedWeights={{ 'contour.jaw_angle': max }}
    />,
  )
  expect(screen.getByText('턱선을 더 모아 보려면 좁게 움직여 보세요.')).toBeVisible()
  expect(screen.queryByRole('button', { name: /사각턱.*비교/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '사각턱 직접 조절하기' }))
  expect(openSlider).toHaveBeenCalledWith('contour.jaw_angle', {})
  expect(props.consult.send).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /턱끝.*비교/ })).not.toBeInTheDocument()
})

it('눈·코·윤곽의 근거를 제안하고 앞트임을 직접 조절로 연결한다', () => {
  const chat = consult([])
  const onOpenSlider = vi.fn()
  const prompt = '어디부터 바꿔보면 좋을까요?'
  const props = {
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    faceProfile: {
      ...comparisonProfile,
      eyes: [
        {
          id: 'intercanthal-outer-eye-width',
          label: '눈 안쪽 간격',
          value: '0.42배',
          method: '눈 모서리 사이를 쟀어요.',
        },
      ],
    },
    savedWeights: {},
    supportedSliderCodes: ['nose.tip_projection', 'contour.jaw_angle'],
    eyeSliderAvailable: true,
    eyeLimits: { inner: 20 },
    onOpenSlider,
    onComparisonView: vi.fn(),
  }
  const { rerender } = render(<ConsultPanel {...props} consult={chat} />)
  fireEvent.click(screen.getByRole('button', { name: prompt }))
  expect(chat.send).toHaveBeenLastCalledWith(prompt, {
    exampleId: 'next-adjustment',
    profileSection: 'next:jawAngle,projection,eyeInner',
    recommendationMeasurements: {
      'jaw-width-face-width': 0.73,
      'upper-lip-profile-line': -0.055,
      'intercanthal-outer-eye-width': 0.42,
    },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '눈은 그대로 두고 어디부터 바꿔보면 좋을까요?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenLastCalledWith('눈은 그대로 두고 어디부터 바꿔보면 좋을까요?', {
    exampleId: 'next-adjustment',
    profileSection: 'next:jawAngle,projection',
    recommendationMeasurements: { 'jaw-width-face-width': 0.73, 'upper-lip-profile-line': -0.055 },
  })
  const excludeEyes = '눈은 빼고 어디부터 바꿔보면 좋을까요?'
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: excludeEyes },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenLastCalledWith(excludeEyes, {
    exampleId: 'next-adjustment',
    profileSection: 'next:jawAngle,projection',
    recommendationMeasurements: { 'jaw-width-face-width': 0.73, 'upper-lip-profile-line': -0.055 },
  })
  const answer = savedReply('diverse', prompt, 'next:jawAngle,projection,eyeInner')
  rerender(<ConsultPanel {...props} consult={consult(answer)} />)
  expect(screen.getByText('눈-앞트임')).toBeVisible()
  expect(screen.getByText('코-코끝 뒤로')).toBeVisible()
  expect(screen.getByText('윤곽-사각턱')).toBeVisible()
  expect(screen.getByText('지금 시안을 보니, 아래 조절부터 살펴보시는 걸 추천해요.')).toBeVisible()
  fireEvent.click(screen.getByLabelText('앞트임 비교 옵션'))
  expect(screen.getByText('눈머리 간격은 양쪽 눈꼬리 사이 너비의 약 42%예요.')).toBeVisible()
  expect(screen.getByText('눈 안쪽을 더 열어 보려면 앞트임을 조금 늘려 보세요.')).toBeVisible()
  fireEvent.click(screen.getByLabelText('앞트임 근거 보기'))
  expect(screen.getByText('0.42배')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '앞트임 직접 조절하기' }))
  expect(onOpenSlider).toHaveBeenCalledWith('eye.inner', {})
  const eyeState = newEyeState()
  eyeState.L.values.inner = eyeState.R.values.inner = 20
  rerender(<ConsultPanel {...props} eyeState={eyeState} consult={consult(answer)} />)
  expect(screen.getByText('눈머리 사이 여백을 더 두려면 앞트임을 조금 줄여 보세요.')).toBeVisible()
  rerender(<ConsultPanel {...props} eyeSliderAvailable={false} consult={consult(answer)} />)
  expect(screen.getByRole('button', { name: '앞트임 직접 조절하기' })).toBeDisabled()
})

it('첫 화면 중앙에만 시작 버튼을 표시하고 대화 중엔 중복 버튼을 숨긴다', () => {
  const chat = consult([])
  const panel = (session: Consult) => (
    <ConsultPanel consult={session} catalog={SAMPLE_NOSE_CATALOG} faceRatioAvailable />
  )
  const { rerender } = render(panel(chat))
  const conversation = screen.getByRole('region', { name: '상담 대화' })
  const prompt = '어디부터 바꿔보면 좋을까요?'
  const starters = ['내 얼굴 비율 분석', prompt, '콧대를 좀 올려줘'].map((name) =>
    within(conversation).getByRole('button', { name }),
  )
  expect(starters.map((button) => button.className)).toEqual(Array(3).fill(starters[0]!.className))
  expect(screen.getAllByRole('button', { name: prompt })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '코끝을 살짝 올려줘' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '고민 상담' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '저장 없이 3D 비교하기' })).not.toBeInTheDocument()
  fireEvent.click(starters[1]!)
  expect(chat.send).toHaveBeenCalledWith(prompt, {
    exampleId: 'next-adjustment',
    profileSection: 'next:none',
  })
  rerender(panel(consult(savedReply('next', prompt, 'next:none'))))
  expect(screen.queryByRole('button', { name: prompt })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '고민 상담' })).not.toBeInTheDocument()
})

it('생성 시안에서 얼굴 비율을 질문하고 검수 출처를 열 수 있다', async () => {
  const chat = consult([])
  const { rerender } = render(<ConsultPanel consult={chat} catalog={null} faceRatioAvailable />)
  fireEvent.click(screen.getByRole('button', { name: '내 얼굴 비율 분석' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith('내 얼굴 비율 분석', { exampleId: 'face-ratio' }),
  )
  rerender(
    <ConsultPanel
      consult={consult([
        {
          id: 'ratio',
          role: 'assistant',
          content:
            '원본에서 측정했어요.\n\n콧볼 너비 ÷ 눈 안쪽 간격: 1.13~1.25배 출처: https://www.facebase.org/resources/human/facial_norms/notes/',
        },
      ])}
      catalog={null}
      faceRatioAvailable
    />,
  )
  const observation = screen.getByText('원본에서 측정했어요.', { selector: 'p' })
  const ratio = screen.getByText(/콧볼 너비 ÷ 눈 안쪽 간격/, { selector: 'p' })
  const source = screen.getByRole('link', { name: '출처 보기' })
  expect(ratio).toBeVisible()
  expect(observation.nextElementSibling).toBe(ratio)
  expect(ratio).not.toContainElement(source)
  expect(source).toHaveAttribute(
    'href',
    'https://www.facebase.org/resources/human/facial_norms/notes/',
  )
})

it('새로 읽은 전체와 입술 분석에서 각 답변의 근거를 열 수 있다', () => {
  const overall = savedReply('overall', '내 얼굴 비율 분석', 'overall')
  const lips = savedReply('lips', '입술은요?', 'lips')
  const chat = consult([...overall, ...lips])
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      faceRatioAvailable
      faceProfile={{
        overall: [],
        eyes: [{ label: '눈 너비', value: '0.33배', method: '눈 기준점을 비교했어요.' }],
        lips: [
          {
            id: 'lower-upper-vermilion-height',
            label: '아랫입술 / 윗입술 높이',
            value: '1.60배',
            method: '붉은 부분의 높이를 쟀어요.',
          },
        ],
        lower: [],
        side: [],
      }}
    />,
  )
  const transcript = within(screen.getByRole('list', { name: '상담 내역' }))
  const overallReply = within(
    transcript.getByText('내 얼굴 비율 분석').closest('li')!.nextElementSibling as HTMLElement,
  )
  expect(overallReply.getByText('0.33배')).not.toBeVisible()
  expect(overallReply.getByText('눈 기준점을 비교했어요.')).not.toBeVisible()
  expect(screen.queryByRole('region', { name: '원본 3D 얼굴 비율' })).not.toBeInTheDocument()
  fireEvent.click(overallReply.getByText('측정 근거 보기'))
  expect(overallReply.getByText('눈 기준점을 비교했어요.')).toBeVisible()
  const lipQuestion = transcript.getByText('입술은요?')
  const lipReply = within(lipQuestion.closest('li')!.nextElementSibling as HTMLElement)
  expect(lipReply.getByText(/아랫입술이 더 높게 측정됐어요/)).toBeVisible()
  expect(lipReply.getByText('1.60배')).not.toBeVisible()
  fireEvent.click(lipReply.getByText('측정 근거 보기'))
  expect(lipReply.getByText('붉은 부분의 높이를 쟀어요.')).toBeVisible()
  expect(screen.getByRole('link', { name: '1:1.6 선호 연구' })).toBeVisible()
  expect(chat.send).not.toHaveBeenCalled()
})

it('원본 검수 기록을 읽고 새 시안에서 이전 검수값을 표시하지 않는다', async () => {
  const chat = consult(savedReply('profile', '내 얼굴 비율 분석', 'overall'))
  const get = vi.spyOn(api, 'get')
  const record = {
    definition: 'alar-lateral-frontal-basal-v1',
    unit: 'model-space',
    quality: 'reviewed-pair',
  }
  get
    .mockResolvedValueOnce({
      status: 'AVAILABLE',
      observations: [
        { ...record, code: 'alarWidth', lower: 1, upper: 1.2 },
        { ...record, code: 'intercanthalDistance', lower: 1.1, upper: 1.3 },
      ],
    })
    .mockResolvedValueOnce({ status: 'DEFERRED', observations: [] })
  try {
    const { rerender } = render(
      <ConsultPanel consult={chat} catalog={null} faceRatioAvailable faceModelId="first" />,
    )
    fireEvent.click(screen.getByText('측정 근거 보기'))
    expect(await screen.findByText('0.76~1.10배')).toBeVisible()
    expect(screen.getByText(/검수 범위가 겹치거나 닿아/)).toBeVisible()
    expect(get).toHaveBeenCalledWith('/face-models/first/baseline-measurements', {
      signal: expect.any(AbortSignal),
    })
    rerender(<ConsultPanel consult={chat} catalog={null} faceRatioAvailable faceModelId="second" />)
    expect(screen.queryByText('0.76~1.10배')).not.toBeInTheDocument()
    expect(await screen.findByText(/등록된 콧볼·눈 안쪽 검수 기록이 없어요/)).toBeVisible()
    expect(chat.send).not.toHaveBeenCalled()
  } finally {
    get.mockRestore()
  }
})

it('전체 분석은 근거가 있는 열린 후보를 보내고 저장된 답변에 3D 비교를 연결한다', async () => {
  const request = '내 얼굴 비율 분석'
  const chat = consult([])
  const view = vi.fn()
  const openSlider = vi.fn()
  const catalog = {
    ...SAMPLE_NOSE_CATALOG,
    parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART],
  }
  const props = {
    catalog,
    faceRatioAvailable: true,
    faceProfile: {
      ...comparisonProfile,
      eyes: [
        {
          id: 'intercanthal-outer-eye-width',
          label: '눈 안쪽 간격',
          value: '0.41배',
          method: '양쪽 눈머리 사이의 폭을 비교했어요.',
        },
      ],
    },
    supportedSliderCodes: ['contour.chin_projection', 'contour.jaw_angle'],
    savedWeights: {},
    onComparisonView: view,
    onOpenSlider: openSlider,
  }
  const { rerender } = render(<ConsultPanel {...props} consult={chat} />)
  fireEvent.click(screen.getByRole('button', { name: request }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(request, {
      exampleId: 'face-ratio',
      profileSection: 'analysis:overall:chinProjection,jawAngle',
      recommendationMeasurements: {
        'upper-lip-profile-line': -0.055,
        'jaw-width-face-width': 0.73,
      },
    }),
  )

  const saved = consult(savedReply('analysis', request, 'analysis:overall:jawAngle,chinProjection'))
  rerender(<ConsultPanel {...props} consult={saved} />)
  const reply = screen.getByRole('list', { name: '상담 내역' })
  expect(within(reply).getByText(/눈머리 사이 간격은.*절반보다 좁아요/)).toBeVisible()
  expect(within(reply).getByText('0.41배')).not.toBeVisible()
  expect(within(reply).getByText(/옆모습에서 윗입술은.*선의 뒤/)).toBeVisible()
  expect(within(reply).getByText(/정면에서 아래턱 폭은.*좁아요/)).toBeVisible()
  expect(within(reply).queryByRole('group', { name: '분석 부위' })).not.toBeInTheDocument()
  const evidence = within(reply).getByLabelText('턱끝 앞뒤 근거 보기')
  expect(within(evidence.closest('details')!).getByText('-5.5%')).not.toBeVisible()
  const headings = within(reply)
    .getAllByRole('heading', { level: 3 })
    .filter((node) => ['사각턱', '턱끝 앞뒤'].includes(node.textContent ?? ''))
  expect(headings.map((node) => node.textContent)).toEqual(['사각턱', '턱끝 앞뒤'])

  fireEvent.click(within(reply).getByRole('button', { name: '턱끝 뒤로 비교' }))
  expect(view).toHaveBeenCalledWith('side')
  expect(saved.send).toHaveBeenCalledWith('턱끝을 조금 뒤로 넣어서 보여줘', {
    exampleId: 'consult-preview',
    comparisonTarget: { code: 'contour.chin_projection', value: -0.1 },
    comparisonAnchorId: 'analysis:chinProjection',
  })
  fireEvent.click(within(reply).getByRole('button', { name: '턱끝 앞뒤 직접 조절하기' }))
  expect(openSlider).toHaveBeenCalledWith('contour.chin_projection', {})
})

it('전체·눈 분석에 앞트임 근거와 직접 조절을 연결하고 한계가 0이면 숨긴다', () => {
  const request = '제 눈 비율을 분석해 주세요'
  const chat = consult([])
  const onOpenSlider = vi.fn()
  const props = {
    catalog: null,
    faceRatioAvailable: true,
    faceProfile: {
      ...comparisonProfile,
      eyes: [
        {
          id: 'intercanthal-outer-eye-width',
          label: '눈 안쪽 간격',
          value: '0.42배',
          method: '눈 모서리 사이를 쟀어요.',
        },
      ],
    },
    savedWeights: {},
    eyeSliderAvailable: true,
    eyeLimits: { inner: 20 },
    onOpenSlider,
  }
  const { rerender } = render(<ConsultPanel {...props} consult={chat} />)
  fireEvent.click(screen.getByRole('button', { name: '내 얼굴 비율 분석' }))
  expect(chat.send).toHaveBeenLastCalledWith('내 얼굴 비율 분석', {
    exampleId: 'face-ratio',
    profileSection: 'analysis:overall:eyeInner',
    recommendationMeasurements: { 'intercanthal-outer-eye-width': 0.42 },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: request },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenLastCalledWith(request, {
    exampleId: 'face-ratio',
    profileSection: 'analysis:eyes:eyeInner',
    recommendationMeasurements: { 'intercanthal-outer-eye-width': 0.42 },
  })

  const saved = consult(savedReply('eye-analysis', request, 'analysis:eyes:eyeInner'))
  rerender(<ConsultPanel {...props} consult={saved} />)
  const evidence = screen.getByLabelText('앞트임 근거 보기')
  fireEvent.click(evidence)
  expect(within(evidence.closest('details')!).getByText('0.42배')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '앞트임 직접 조절하기' }))
  expect(onOpenSlider).toHaveBeenCalledWith('eye.inner', {})
  rerender(<ConsultPanel {...props} consult={saved} eyeLimits={{ inner: 0 }} />)
  expect(screen.queryByRole('button', { name: '앞트임 직접 조절하기' })).not.toBeInTheDocument()
})

it('잠긴 조절이나 빠진 기준점은 분석에 비교 버튼을 표시하지 않는다', () => {
  const chat = consult(savedReply('analysis', '인중·턱을 보고 싶어요.', 'analysis:lower:jawAngle'))
  const catalog = {
    ...SAMPLE_NOSE_CATALOG,
    parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART],
  }
  const props = { consult: chat, catalog, savedWeights: {}, onComparisonView: vi.fn() }
  const { rerender } = render(
    <ConsultPanel {...props} faceProfile={comparisonProfile} supportedSliderCodes={[]} />,
  )
  expect(screen.getByText(/아래턱 폭은 얼굴 양옆 너비보다 좁아요/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /사각턱 .*비교/ })).not.toBeInTheDocument()
  rerender(
    <ConsultPanel
      {...props}
      faceProfile={{ ...comparisonProfile, lower: [] }}
      supportedSliderCodes={['contour.jaw_angle']}
    />,
  )
  expect(screen.getByText(/기준점이 충분하지 않아요/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /사각턱 .*비교/ })).not.toBeInTheDocument()
})

it('분석 카드에 대한 일상 후속 질문은 비율 수치 없이 열린 부위만 전송한다', () => {
  const chat = consult(savedReply('overall', '내 얼굴 비율 분석', 'overall'))
  const get = vi.spyOn(api, 'get').mockResolvedValue({ status: 'DEFERRED', observations: [] })
  try {
    const { rerender } = render(
      <ConsultPanel consult={chat} catalog={null} faceRatioAvailable faceModelId="test" />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
      target: { value: '아랫쪽은 어떤지 자세히요' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(chat.send).toHaveBeenCalledWith('아랫쪽은 어떤지 자세히요', {
      exampleId: 'consult-advice',
      profileSection: 'overall',
    })
    rerender(
      <ConsultPanel
        consult={{
          ...chat,
          items: [
            {
              id: 'a',
              role: 'assistant',
              content: '측정 방법을 확인해 보세요.',
              profileSection: 'lower',
            },
          ],
        }}
        catalog={null}
        faceRatioAvailable
        faceModelId="test"
      />,
    )
    expect(screen.getByText('측정 근거 보기')).toBeVisible()
    expect(screen.queryByRole('button', { name: '인중·턱' })).not.toBeInTheDocument()
  } finally {
    get.mockRestore()
  }
})

it('턱선 설명만 요청하면 인중이나 수정 추천 없이 아래턱 폭을 설명한다', () => {
  const request = '정면에서 턱선이 어떻게 보이나요? 바로 변경하지 말고 설명만 해줘.'
  const chat = consult([])
  const faceProfile = {
    ...comparisonProfile,
    lower: [
      ...comparisonProfile.lower,
      {
        id: 'philtrum-nose-base-to-chin',
        label: '인중 길이',
        value: '0.22배',
        method: '코밑을 쟀어요.',
      },
    ],
  }
  const props = {
    consult: chat,
    catalog: SAMPLE_NOSE_CATALOG,
    faceProfile,
    faceRatioAvailable: true,
    savedWeights: {},
  }
  const { rerender } = render(<ConsultPanel {...props} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: request },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).toHaveBeenCalledWith(request, {
    exampleId: 'face-ratio',
    profileSection: 'lower',
  })
  rerender(
    <ConsultPanel
      {...props}
      consult={{ ...chat, items: savedReply('jaw', request, 'analysis:lower:jawAngle,chinLength') }}
    />,
  )
  expect(screen.getByText(/정면에서 아래턱 폭은/)).toBeVisible()
  expect(screen.queryByText(/인중이 약/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /직접 조절하기|비교 옵션/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('측정 근거 보기'))
  expect(screen.getByText('턱 너비')).toBeVisible()
  expect(screen.queryByText('인중 길이')).not.toBeInTheDocument()
})

it('현재 시안의 편집 결과를 분석과 다음 추천에 반영한다', async () => {
  const chat = consult(savedReply('profile', '내 얼굴 비율 분석', 'lower'))
  const currentProfile = {
    ...comparisonProfile,
    lower: [{ ...comparisonProfile.lower[0], value: '0.67배' }],
  }
  const props = {
    consult: chat,
    catalog: { ...SAMPLE_NOSE_CATALOG, parts: [SAMPLE_CONTOUR_PART] },
    faceRatioAvailable: true,
    originalFaceProfile: comparisonProfile,
    supportedSliderCodes: ['contour.jaw_angle'],
    savedWeights: {},
    modeSwitch: { stateVersion: 5, revision: 'saved-morph-5' },
  }
  const { rerender } = render(<ConsultPanel {...props} faceProfile={currentProfile} />)
  expect(screen.getByText(/0\.73배에서 0\.67배로 달라졌어요/)).toBeVisible()
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '어디부터 바꿔보면 좋을까요?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(
      '어디부터 바꿔보면 좋을까요?',
      expect.objectContaining({ recommendationMeasurements: { 'jaw-width-face-width': 0.67 } }),
    ),
  )
  rerender(<ConsultPanel {...props} faceProfile={comparisonProfile} />)
  expect(screen.queryByText(/0\.73배에서 0\.67배로 달라졌어요/)).not.toBeInTheDocument()
})

it('상담 첫 화면에서 3D 준비 상태를 알리고 준비되면 분석과 추천을 함께 보여 준다', () => {
  const props = { consult: consult([]), catalog: null, faceRatioAvailable: true }
  const { rerender } = render(<ConsultPanel {...props} faceProfileState="loading" />)
  const analysis = { name: '내 얼굴 비율 분석' }
  const recommendation = { name: '어디부터 바꿔보면 좋을까요?' }
  const input = screen.getByRole('textbox', { name: '원하는 변화' })
  expect(screen.getByRole('status')).toHaveTextContent('현재 시안의 3D를 불러오는 중이에요.')
  expect(screen.queryByRole('button', analysis)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', recommendation)).not.toBeInTheDocument()
  expect(input).toBeEnabled()
  fireEvent.change(input, { target: { value: '콧대 조절이 궁금해요' } })

  rerender(<ConsultPanel {...props} faceProfileState="unavailable" />)
  expect(screen.getByRole('status')).toHaveTextContent(/3D를 불러오지 못했어요/)
  expect(screen.queryByRole('button', analysis)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', recommendation)).not.toBeInTheDocument()
  expect(input).toHaveValue('콧대 조절이 궁금해요')

  rerender(<ConsultPanel {...props} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', analysis)).toBeEnabled()
  expect(screen.getByRole('button', recommendation)).toBeEnabled()
  expect(input).toHaveValue('콧대 조절이 궁금해요')
})

it.each(['ready', 'unavailable'] as const)(
  '로딩 중 다음 추천을 보내고 3D 상태가 %s인 경우를 처리한다',
  async (status) => {
    const chat = consult([])
    const props = { consult: chat, catalog: null, faceRatioAvailable: true }
    const question = '나 쌍꺼풀 바꿨는데, 그 다음 뭐 바꿔볼까? 추천해줘'
    const { rerender } = render(<ConsultPanel {...props} faceProfileState="loading" />)
    const input = screen.getByRole('textbox', { name: '원하는 변화' })
    fireEvent.change(input, { target: { value: question } })
    fireEvent.submit(input.closest('form')!)
    expect(screen.getByText(/3D가 준비되면 이어서 추천/)).toBeVisible()
    expect(chat.send).not.toHaveBeenCalled()

    rerender(
      <ConsultPanel
        {...props}
        faceProfile={comparisonProfile}
        faceProfileState={status === 'ready' ? undefined : status}
      />,
    )
    if (status === 'unavailable') {
      await waitFor(() => expect(input).toHaveValue(question))
      expect(chat.send).not.toHaveBeenCalled()
    } else {
      await waitFor(() =>
        expect(chat.send).toHaveBeenCalledWith(
          question,
          expect.objectContaining({ exampleId: 'next-adjustment' }),
        ),
      )
      rerender(<ConsultPanel {...props} faceProfile={comparisonProfile} />)
      expect(chat.send).toHaveBeenCalledTimes(1)
    }
  },
)

it('다음 추천에 현재 아웃라인을 유지한 앞트임의 전후 계측값을 보낸다', async () => {
  const chat = consult([])
  const profile = (ratio: number): FaceProfile => ({
    ...comparisonProfile,
    eyes: [
      {
        id: 'intercanthal-outer-eye-width',
        label: '눈 안쪽 간격',
        value: ratio + '배',
        method: '눈머리 사이 거리',
      },
    ],
  })
  const eyeState = newEyeState()
  for (const eye of [eyeState.L, eyeState.R]) {
    eye.enabled = true
    eye.style = 'outline'
  }
  const measureEye = vi.fn().mockResolvedValue(profile(0.38))
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      faceRatioAvailable
      faceProfile={profile(0.41)}
      savedWeights={{}}
      hasAppliedEyelids
      eyeSliderAvailable
      eyeLimits={{ inner: 50 }}
      eyeState={eyeState}
      measureTrial={Object.assign(vi.fn().mockReturnValue(null), { eye: measureEye })}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '어디부터 바꿔보면 좋을까요?' }))

  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        profileSection: 'next:eyeInner:fold',
        recommendationMeasurements: {
          'intercanthal-outer-eye-width': 0.41,
          'eyeInner:up': 0.38,
          'trial-version': 1,
        },
      }),
    ),
  )
  expect(measureEye).toHaveBeenCalledTimes(1)
  expect(measureEye).toHaveBeenCalledWith(
    expect.objectContaining({
      L: expect.objectContaining({
        enabled: true,
        style: 'outline',
        values: expect.objectContaining({ inner: 15 }),
      }),
      R: expect.objectContaining({
        enabled: true,
        style: 'outline',
        values: expect.objectContaining({ inner: 15 }),
      }),
    }),
  )
  expect(eyeState.L.values.inner).toBe(0)
  expect(eyeState.R.values.inner).toBe(0)
})

it('현재 시안을 불러오는 동안 기준점 부족으로 단정하지 않는다', () => {
  const chat = consult(savedReply('lips', '제 입술 비율은 어때요?', 'lips'))
  const { rerender } = render(
    <ConsultPanel consult={chat} catalog={null} faceRatioAvailable faceProfileState="loading" />,
  )
  expect(screen.getByText('현재 시안의 3D를 확인하고 있어요.')).toBeVisible()
  rerender(
    <ConsultPanel
      consult={chat}
      catalog={null}
      faceRatioAvailable
      faceProfileState="unavailable"
    />,
  )
  expect(screen.getByText(/현재 시안을 분석할 3D를 불러오지 못했어요/)).toBeVisible()
})

it('고민으로 상담을 시작하고 후속 입력도 설명 전용으로 보낸다', async () => {
  const chat = consult([{ id: 'intro', role: 'assistant', content: '조절을 도와드릴게요.' }])
  render(<ConsultPanel consult={chat} catalog={null} />)

  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '고민 상담' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  const transcript = within(screen.getByRole('list', { name: '상담 내역' }))
  expect(transcript.getByText('고민 상담')).toBeVisible()
  expect(transcript.getByText(/어떤 부분이 신경 쓰이세요/)).toBeVisible()
  expect(screen.getByRole('textbox', { name: '원하는 변화' })).toHaveFocus()
  expect(screen.getByRole('button', { name: '고민 상담 끝내기' })).toBeVisible()
  expect(chat.send).not.toHaveBeenCalled()

  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '코끝은 유지하고 싶어요' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenLastCalledWith('코끝은 유지하고 싶어요', {
      exampleId: 'consult-advice',
    }),
  )
})

it('상담 답변의 비교 이어가기는 시안을 바꾸지 않고 입력창을 연다', () => {
  const chat = consult([
    {
      id: 'advice',
      role: 'assistant',
      content: '정면에서 콧볼을 살펴볼 수 있어요.',
      intent: 'REPLY',
      comparisonCode: 'nose.alar_width',
    },
  ])
  render(<ConsultPanel consult={chat} catalog={null} onComparisonView={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '고민 상담' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  fireEvent.click(screen.getByRole('button', { name: '비교할 변화 입력하기' }))
  const input = screen.getByRole('textbox', { name: '원하는 변화' })
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('placeholder', '비교해 보고 싶은 변화를 적어 주세요')
  expect(screen.queryByRole('button', { name: '비교할 변화 입력하기' })).not.toBeInTheDocument()
  const exitComparison = screen.getByRole('button', { name: '저장 없이 비교 중 · 끝내기' })
  fireEvent.click(exitComparison)
  expect(exitComparison).not.toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(chat.send).not.toHaveBeenCalled()
})

it('비교할 부위가 없는 상담 답변에는 이어가기 버튼을 표시하지 않는다', () => {
  const chat = consult([
    { id: 'advice', role: 'assistant', content: '실제 상담에서 확인해 주세요.', intent: 'REPLY' },
  ])
  render(<ConsultPanel consult={chat} catalog={SAMPLE_NOSE_CATALOG} onComparisonView={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '고민 상담' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(screen.queryByRole('button', { name: '비교할 변화 입력하기' })).not.toBeInTheDocument()
})

it('고민 상담의 선택지는 표시 문구가 아니라 ID로 보내고 바로 적용하지 않는다', () => {
  const chat = consult([
    {
      id: 'advice',
      role: 'assistant',
      content: '어디를 먼저 볼까요?',
      intent: 'CLARIFY',
      options: [{ id: 'advice-first', label: '사각턱' }],
    },
  ])
  render(<ConsultPanel consult={chat} catalog={null} />)
  fireEvent.click(screen.getByRole('button', { name: '사각턱' }))
  expect(chat.send).toHaveBeenCalledWith(
    '사각턱',
    {
      selectedOptionId: 'advice-first',
      exampleId: 'consult-advice',
    },
    undefined,
  )
})

it('비율 카드에서 유효한 사각턱 선택 뒤 후속 요청은 저장 없는 비교로 보낸다', async () => {
  const chat = consult([
    {
      id: 'profile',
      role: 'assistant',
      content: '비교할 항목을 골라 주세요.',
      intent: 'CLARIFY',
      profileSection: 'lower',
      options: [{ id: 'advice-jaw', label: '사각턱' }],
    },
  ])
  render(<ConsultPanel consult={chat} catalog={SAMPLE_NOSE_CATALOG} onComparisonView={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '사각턱' }))
  const [, , ready] = vi.mocked(chat.send).mock.calls[0]!
  act(() => ready?.())
  const input = screen.getByRole('textbox', { name: '원하는 변화' })
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: '그럼 조금 줄여줘' } })
  fireEvent.submit(input.closest('form')!)
  expect(chat.send).toHaveBeenLastCalledWith('그럼 조금 줄여줘', {
    exampleId: 'consult-preview',
  })
})

it('새 대화를 불러오는 동안 입력을 잠그고 완료하면 입력창에 포커스를 돌린다', async () => {
  const chat = consult([])
  let finish!: (ok: boolean) => void
  const newConversation = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  const controls = {
    hasOlder: false,
    error: false,
    loadingOlder: false,
    loadOlder: vi.fn(),
    retry: vi.fn(),
    newConversation,
  }
  const panel = (starting: boolean, loading = false) => (
    <ConsultPanel
      consult={{ ...chat, loading, history: { ...controls, starting } }}
      catalog={null}
    />
  )
  const { rerender } = render(panel(false))
  const input = screen.getByRole('textbox', { name: '원하는 변화' })
  fireEvent.change(input, { target: { value: '이전 대화의 초안' } })
  fireEvent.click(screen.getByRole('button', { name: '새 대화' }))
  rerender(panel(true))
  expect(input).toBeDisabled()
  rerender(panel(false, true))
  await act(async () => finish(true))
  expect(input).toBeDisabled()
  rerender(panel(false))
  expect(input).toHaveValue('')
  expect(input).toHaveFocus()
})

it('원하는 변화와 유지할 부위를 함께 수정해 설명 전용으로 보낸다', async () => {
  const chat = consult([{ id: 'intro', role: 'assistant', content: '조절을 도와드릴게요.' }])
  render(<ConsultPanel consult={chat} catalog={null} />)
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '고민 상담' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  fireEvent.click(screen.getByRole('button', { name: '상담 목표와 유지할 부위' }))
  fireEvent.change(screen.getByRole('textbox', { name: '상담에서 원하는 변화' }), {
    target: { value: '정면에서 코 옆을 비교' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '유지할 부위' }), {
    target: { value: '코끝' },
  })
  fireEvent.click(screen.getByRole('button', { name: '이 조건으로 상담하기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith('상담 목표: 정면에서 코 옆을 비교 / 유지할 부위: 코끝', {
      exampleId: 'consult-advice',
    }),
  )
})

it.each([
  [
    '이 얼굴에서는 해당 부위를 아직 조절할 수 없어요.',
    '직접 조절에 열린 항목과 원하는 방향을 말씀해 주세요.',
  ],
  ['먼저 조절 모드를 전환해 주세요. 얼굴은 그대로예요.', '어떤 값이 원래대로 돌아가는지'],
  ['현재 조절 한계에서 더 바뀌지 않았어요.', '반대 방향이나 더 작은 변화'],
])('편집이 막혔을 때 안내를 열어도 상담 요청이나 편집을 실행하지 않는다', (content, help) => {
  const chat = consult([{ id: 'a', role: 'assistant', intent: 'REPLY', content }])
  const openSlider = vi.fn()
  render(<ConsultPanel consult={chat} catalog={null} onOpenSlider={openSlider} />)
  const disclosure = screen.getByText('가능한 다음 조절 보기')
  fireEvent.click(disclosure)
  expect(disclosure.closest('details')).toHaveAttribute('open')
  expect(screen.getByText(new RegExp(help))).toBeVisible()
  expect(chat.send).not.toHaveBeenCalled()
  expect(openSlider).not.toHaveBeenCalled()
})

it('체중 변화 바로가기 없이도 채팅 명령으로 전환 확인을 열 수 있다', () => {
  const chat = consult([])
  const apply = vi.fn().mockResolvedValue(true)
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      modeSwitch={{ revision: '1', toWeight: { clears: '눈 조절', apply } }}
    />,
  )
  expect(screen.queryByRole('button', { name: /^체중 변화$/ })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: '체중 변화로 전환해줘' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(screen.getByRole('group', { name: '조절 모드 전환 확인' })).toBeVisible()
  expect(apply).not.toHaveBeenCalled()
  expect(chat.send).not.toHaveBeenCalled()
})

it('초기화할 항목을 먼저 보여 주고 확인 뒤에만 후속 조절을 보낸다', async () => {
  const chat = consult([])
  const apply = vi.fn().mockResolvedValue(true)
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      modeSwitch={{
        revision: '1',
        toFace: { clears: '체중 변화', apply },
      }}
    />,
  )
  const request = () => {
    fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
      target: { value: '체중 변화를 원본으로 돌리고 앞트임을 넓혀줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  }
  request()
  expect(screen.getByText(/전환하면 체중 변화 조절값이 원본/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  expect(apply).not.toHaveBeenCalled()
  expect(chat.send).not.toHaveBeenCalled()
  request()
  fireEvent.click(screen.getByRole('button', { name: '전환하기' }))
  await waitFor(() => expect(chat.send).toHaveBeenCalledWith('앞트임을 넓혀줘'))
  expect(apply).toHaveBeenCalledTimes(1)
})

it.each([
  '체중 변화를 원본으로 돌리고',
  '얼굴 조절로 전환하고',
  '눈·코·윤곽 모드로 전환하고',
  '눈·코·윤곽으로 바꾸고',
])('생성 시안에서 “%s” 뒤 조절은 확인한 버전과 함께 보낸다', async (prefix) => {
  const chat = consult([])
  const apply = vi.fn().mockResolvedValue(true)
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      modeSwitch={{ revision: '4', stateVersion: 4, toFace: { clears: '체중 변화', apply } }}
    />,
  )
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: `${prefix} 앞트임을 10으로 맞춰줘` },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '전환하기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith('앞트임을 10으로 맞춰줘', {
      modeSwitch: { target: 'toFace', stateVersion: 4 },
    }),
  )
  expect(apply).not.toHaveBeenCalled()
})

it.each(['20', '-20'])('체중 모드 전환을 확인하면 강도 %s를 체중 조절로 보낸다', async (value) => {
  const chat = consult([])
  const apply = vi.fn().mockResolvedValue(true)
  render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      modeSwitch={{ revision: '4', stateVersion: 4, toWeight: { clears: '코', apply } }}
    />,
  )
  fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
    target: { value: `체중 변화로 전환하고 강도를 ${value}으로 맞춰줘` },
  })
  fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  expect(chat.send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '전환하기' }))
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledWith(`체중 변화 강도를 ${value}으로 맞춰줘`, {
      modeSwitch: { target: 'toWeight', stateVersion: 4 },
    }),
  )
  expect(apply).not.toHaveBeenCalled()
})

describe('ConsultPanel — 첫 화면 한계 안내', () => {
  it('체중 변화 상담 결과는 변화율 대신 미리보기 강도를 표시한다', () => {
    const { rows } = visibleApplyRows(
      {
        summary: '체중 변화 미리보기 변경',
        applied: [{ code: 'contour.weight_shape', from: 0, to: -0.4, limited: false }],
        skipped: [],
        seq: 1,
        limited: false,
      },
      null,
    )
    expect(rows).toEqual([
      expect.objectContaining({
        label: '체중 변화',
        value: '원본 → 감량 방향 · 강도 40',
      }),
    ])
  })

  it('열린 윤곽과 체중 변화 슬라이더만 상담 범위에 넣는다', () => {
    const catalog: MorphParameterCatalog = {
      ...SAMPLE_NOSE_CATALOG,
      parts: [
        ...SAMPLE_NOSE_CATALOG.parts,
        {
          ...SAMPLE_CONTOUR_PART,
          items: [
            ...SAMPLE_CONTOUR_PART.items,
            {
              code: 'contour.weight_shape',
              subPart: 'WEIGHT_SHAPE',
              label: '체중 변화',
              min: -1,
              max: 1,
              default: 0,
              step: 0.01,
            },
          ],
        },
      ],
    }
    expect(sliderPartsNotice(catalog, ['contour.cheekbone', 'contour.weight_shape'])).toBe(
      '이 모델에서 채팅으로 조절할 수 있는 항목은 광대·체중입니다.',
    )
  })
  it('첫 화면에서는 짧은 질문과 조절 예시를 표시한다', () => {
    render(
      <ConsultPanel
        consult={consult([])}
        catalog={SAMPLE_NOSE_CATALOG}
        supportedSliderCodes={[
          'nose.bridge_height',
          'nose.tip_projection',
          'nose.tip_height',
          'nose.tip_rotation',
          'nose.alar_width',
        ]}
      />,
    )
    expect(screen.getByText('어떤 모습이 신경 쓰이세요?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '콧대를 좀 올려줘' })).toBeVisible()
    expect(screen.queryByText(/이 모델에서 채팅으로 조절할 수 있는 항목/)).not.toBeInTheDocument()
  })

  it('코와 눈이 열린 모델은 현재 지원하는 조절로 예시를 구성한다', () => {
    render(
      <ConsultPanel
        consult={consult([])}
        catalog={SAMPLE_NOSE_CATALOG}
        supportedSliderCodes={['nose.bridge_height']}
        eyeSliderAvailable
      />,
    )
    expect(screen.getByRole('button', { name: '콧대를 좀 올려줘' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '코끝을 살짝 올려줘' })).not.toBeInTheDocument()
  })

  it('눈만 열린 모델에서 코도 바꿀 수 있다고 단정하지 않는다', () => {
    render(
      <ConsultPanel
        consult={consult([])}
        catalog={SAMPLE_NOSE_CATALOG}
        supportedSliderCodes={[]}
        eyeSliderAvailable
        eyeLimits={{ inner: 0, outer: 40 }}
      />,
    )
    expect(screen.queryByText(/코와 눈을 바꿀 수/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '뒤트임을 조금 넓혀줘' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /콧대|코끝|앞트임/ })).not.toBeInTheDocument()
  })

  it('보관 대화에서 입력창을 숨기고 이전 메시지를 더 볼 수 있다', () => {
    const loadOlder = vi.fn()
    const viewConversation = vi.fn()
    const chat = consult([{ id: 'archived-1', role: 'user', content: '보관된 요청' }])
    const panel = (loadingOlder: boolean) => (
      <ConsultPanel
        consult={{
          ...chat,
          history: {
            archived: true,
            error: false,
            retry: vi.fn(),
            hasArchived: true,
            hasOlder: true,
            loadingOlder,
            loadOlder,
            viewConversation,
            newConversation: vi.fn(),
          },
        }}
        catalog={null}
      />
    )
    const { rerender } = render(panel(false))

    expect(screen.getByText('보관된 요청')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: '원하는 변화' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 메시지 더 보기' }))
    expect(loadOlder).toHaveBeenCalledOnce()

    rerender(panel(true))
    expect(screen.getByRole('button', { name: '현재 대화' })).toBeDisabled()
    rerender(panel(false))
    fireEvent.click(screen.getByRole('button', { name: '현재 대화' }))
    expect(viewConversation).toHaveBeenCalledWith(false)
  })

  it('조회 오류를 첫 상담 화면으로 보이지 않고 재시도할 수 있다', () => {
    const retry = vi.fn()
    render(
      <ConsultPanel
        consult={{
          ...consult([]),
          history: { error: true, retry, hasOlder: false, loadingOlder: false, loadOlder: vi.fn() },
        }}
        catalog={null}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('대화를 불러오지 못했어요.')
    expect(screen.queryByText('원하는 모습을 편하게 적어 주세요.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '대화 다시 불러오기' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('열린 코 조절만 이름에 넣고 눈은 넣지 않는다, 모르면 일반 문구 (-158)', () => {
    expect(sliderPartsNotice(SAMPLE_NOSE_CATALOG, ['nose.bridge_height'])).toBe(
      '이 모델에서 채팅으로 조절할 수 있는 항목은 콧대입니다.',
    )
    expect(sliderPartsNotice(SAMPLE_NOSE_CATALOG, [])).toBe(
      '이 모델에서 열린 조절 항목을 채팅으로 안내해 드릴게요.',
    )
    expect(sliderPartsNotice(null)).toBe('이 모델에서 열린 조절 항목을 채팅으로 안내해 드릴게요.')
  })
})

describe('ConsultPanel — 긴 대화', () => {
  it('코끝 위아래 결과에서 현재 사용할 수 있는 공유 슬라이더를 연다', () => {
    const openSlider = vi.fn()
    const chat = consult([
      {
        id: 'tip',
        role: 'assistant',
        content: '',
        applyResult: {
          summary: '코끝 위아래 변경',
          applied: [
            { code: 'nose.tip_height', from: 0, to: 0.06, limited: false },
            { code: 'nose.tip_rotation', from: 0, to: 0.04, limited: false },
          ],
          skipped: [],
          seq: 1,
          limited: false,
        },
      },
    ])
    const props = { consult: chat, catalog: SAMPLE_NOSE_CATALOG, onOpenSlider: openSlider }
    const { rerender } = render(
      <ConsultPanel {...props} supportedSliderCodes={['nose.tip_height', 'nose.tip_rotation']} />,
    )
    expect(screen.getByText('코끝을 올려드렸어요.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '코끝 위아래 직접 조절하기' }))
    expect(openSlider).toHaveBeenCalledWith('nose.tip_height')

    rerender(<ConsultPanel {...props} supportedSliderCodes={['nose.tip_height']} />)
    expect(
      screen.queryByRole('button', { name: '코끝 위아래 직접 조절하기' }),
    ).not.toBeInTheDocument()
  })

  it('윤곽 적용 결과를 말로 설명하고 정확한 값은 펼쳐서 확인한다', () => {
    render(
      <ConsultPanel
        consult={consult([
          {
            id: 'contour',
            role: 'assistant',
            content: '',
            applyResult: {
              summary: '광대 크기 변경',
              applied: [{ code: 'contour.cheekbone', from: 0, to: 0.1, limited: false }],
              skipped: [],
              seq: 1,
              limited: false,
            },
          },
        ])}
        catalog={{
          ...SAMPLE_NOSE_CATALOG,
          parts: [...SAMPLE_NOSE_CATALOG.parts, SAMPLE_CONTOUR_PART],
        }}
      />,
    )
    const card = screen.getByRole('region', { name: '3D 반영 결과' })
    expect(within(card).getByText('광대를 키워드렸어요.')).toBeVisible()
    expect(within(card).getByText('0% → +10%')).not.toBeVisible()
    fireEvent.click(within(card).getByText('조절값 보기'))
    expect(within(card).getByText('0% → +10%')).toBeVisible()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })

  it('눈 모양마다 다른 승인 한계로 적용 전후 %를 계산하고 실제 값 변화만 표시한다', () => {
    const before = newEyeState()
    before.L.enabled = true
    before.L.style = 'inline'
    before.L.values.height = 10
    const after = structuredClone(before)
    after.L.style = 'inout'
    after.L.values.height = 24
    const { rows } = visibleApplyRows(
      {
        summary: '눈 변경',
        applied: [],
        eyeBefore: before,
        eyeAfter: after,
        eyeLimits: { 'inline:height': 20, 'inout:height': 40 },
        skipped: [],
        seq: 1,
        limited: false,
      },
      null,
    )
    expect(rows).toEqual([
      expect.objectContaining({ label: '오른쪽 쌍꺼풀 모양', value: '인라인 → 인아웃' }),
      expect.objectContaining({ label: '오른쪽 쌍꺼풀 높이', value: '50% → 60%' }),
    ])
  })

  it('눈 상담 반영 카드는 실제 양쪽 값을 한 항목으로 보여 준다', () => {
    const openSlider = vi.fn()
    const before = newEyeState()
    const after = structuredClone(before)
    after.L.values.inner = 5
    after.R.values.inner = 5
    render(
      <ConsultPanel
        consult={consult([
          {
            id: 'eye',
            role: 'assistant',
            content: '',
            applyResult: {
              summary: '앞트임 변경',
              applied: [{ code: 'eye.inner', from: 0, to: 5, limited: false }],
              eyeBefore: before,
              eyeAfter: after,
              eyeLimits: { inner: 50 },
              skipped: [],
              seq: 1,
              limited: false,
            },
          },
        ])}
        catalog={null}
        eyeSliderAvailable
        eyeLimits={{ inner: 50 }}
        onOpenSlider={openSlider}
      />,
    )
    expect(screen.getByText('앞트임을 넓혔어요.')).toBeVisible()
    expect(screen.getByText('0% → 10%')).not.toBeVisible()
    fireEvent.click(screen.getByText('조절값 보기'))
    expect(screen.getByText('0% → 10%')).toBeVisible()
    expect(screen.queryByText('eye.inner')).not.toBeInTheDocument()
    expect(screen.queryByText('+500%')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '앞트임 직접 조절하기' }))
    expect(openSlider).toHaveBeenCalledWith('eye.inner')
  })

  it('제보 메일에는 상담 원문을 자동으로 담지 않는다', () => {
    render(
      <ConsultPanel
        consult={consult([{ id: '1', role: 'user', content: '합성 제보 원문' }])}
        catalog={null}
      />,
    )
    const href = decodeURIComponent(
      screen.getByRole('link', { name: '상담 결과가 의도와 달라요' }).getAttribute('href') ?? '',
    )
    expect(href).toContain(`mailto:${CONTACT}`)
    expect(href).toContain('기대한 변화:')
    expect(href).toContain('얼굴 사진·3D 모델·실명·개인 측정값은 보내지 마세요.')
    expect(href).not.toContain('합성 제보 원문')
  })

  it('검수된 코 용어 답변의 출처를 링크로 보여준다', () => {
    render(
      <ConsultPanel
        consult={consult([
          {
            id: 'term',
            role: 'assistant',
            content:
              '콧등의 윤곽을 뜻해요. 출처: https://pmc.ncbi.nlm.nih.gov/articles/PMC7159929/',
          },
        ])}
        catalog={null}
      />,
    )
    expect(screen.getByText('콧등의 윤곽을 뜻해요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '출처 보기' })).toHaveAttribute(
      'href',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC7159929/',
    )
  })

  it('서로 다른 코 용어의 출처 두 개를 각각 링크로 보여준다', () => {
    render(
      <ConsultPanel
        consult={consult([
          {
            id: 'comparison',
            role: 'assistant',
            content:
              '비주는 두 콧구멍 사이예요. 비순각은 코 아래쪽 각도예요. 출처: https://pmc.ncbi.nlm.nih.gov/articles/PMC2526105/, https://pmc.ncbi.nlm.nih.gov/articles/PMC4956864/',
          },
        ])}
        catalog={null}
      />,
    )
    expect(
      screen.getByText('비주는 두 콧구멍 사이예요. 비순각은 코 아래쪽 각도예요.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '출처 1' })).toHaveAttribute(
      'href',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC2526105/',
    )
    expect(screen.getByRole('link', { name: '출처 2' })).toHaveAttribute(
      'href',
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC4956864/',
    )
  })

  it('Enter로 보내고 Shift+Enter는 줄바꿈으로 남긴다', async () => {
    const session = consult([])
    render(<ConsultPanel consult={session} catalog={null} />)
    const input = screen.getByRole('textbox', { name: '원하는 변화' })
    fireEvent.change(input, { target: { value: '콧대를 올려줘' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(session.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() =>
      expect(session.send).toHaveBeenCalledExactlyOnceWith('콧대를 올려줘', undefined),
    )
    expect(input).toHaveValue('')
  })

  it('전송 직후 입력창을 비우고 실패하면 보낸 문장을 복원한다', async () => {
    let finish!: (ok: boolean) => void
    const session = consult([])
    session.send = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    render(<ConsultPanel consult={session} catalog={null} />)
    const input = screen.getByRole('textbox', { name: '원하는 변화' })

    fireEvent.change(input, { target: { value: '코 높여줘' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    expect(input).toHaveValue('')

    await act(async () => finish(false))
    expect(input).toHaveValue('코 높여줘')
  })

  it('실패해도 전송 중 새로 쓴 초안을 덮어쓰지 않고 예시 버튼은 초안을 유지한다', async () => {
    let finish!: (ok: boolean) => void
    const session = consult([])
    session.send = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))
    render(<ConsultPanel consult={session} catalog={SAMPLE_NOSE_CATALOG} />)
    const input = screen.getByRole('textbox', { name: '원하는 변화' })

    fireEvent.change(input, { target: { value: '코 높여줘' } })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
    fireEvent.change(input, { target: { value: '새 요청' } })
    await act(async () => finish(false))
    expect(input).toHaveValue('새 요청')

    fireEvent.click(screen.getByRole('button', { name: '콧대를 좀 올려줘' }))
    expect(input).toHaveValue('새 요청')
    await act(async () => finish(true))
  })

  it('불러온 대화의 끝을 보이고 입력창은 스크롤 영역 밖에 둔다', () => {
    const { rerender } = render(
      <ConsultPanel consult={consult([])} catalog={SAMPLE_NOSE_CATALOG} />,
    )
    expect(screen.getByRole('button', { name: '콧대를 좀 올려줘' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '코끝을 살짝 올려줘' })).toBeInTheDocument()
    const conversation = screen.getByRole('region', { name: '상담 대화' })
    const input = screen.getByRole('textbox', { name: '원하는 변화' })
    expect(conversation.contains(input)).toBe(false)

    Object.defineProperty(conversation, 'scrollHeight', { configurable: true, value: 600 })
    rerender(
      <ConsultPanel
        consult={consult([
          { id: '1', role: 'user', content: '처음 질문' },
          { id: '2', role: 'assistant', content: '가장 최근 답변' },
        ])}
        catalog={null}
      />,
    )
    expect(conversation.scrollTop).toBe(600)
    expect(screen.getByText('가장 최근 답변')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '콧대를 좀 올려줘' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '원하는 변화' })).toBeInTheDocument()
  })
})

describe('ConsultPanel — 화면 녹화 가리기 (S15P31B204-553)', () => {
  it('보낸 문장·답변과 입력창을 Clarity 녹화에서 가린다', () => {
    render(
      <ConsultPanel
        consult={consult([
          { id: '1', role: 'user', content: '내가 보낸 문장' },
          { id: '2', role: 'assistant', content: '받은 답변' },
        ])}
        catalog={null}
      />,
    )
    expect(screen.getByText('내가 보낸 문장').closest('[data-clarity-mask]')).not.toBeNull()
    expect(screen.getByText('받은 답변').closest('[data-clarity-mask]')).not.toBeNull()
    expect(screen.getByRole('textbox', { name: '원하는 변화' })).toHaveAttribute(
      'data-clarity-mask',
    )
  })
})

it('직접 조절에서 선택한 코드와 버전을 보낸다. 선택을 지우면 여기만 요청을 보내지 않는다', async () => {
  const chat = consult([])
  const clear = vi.fn()
  const { rerender } = render(
    <ConsultPanel
      consult={chat}
      catalog={null}
      directControl={{ code: 'nose.tip_height', label: '코끝 위아래', stateVersion: 3 }}
      onClearDirectControl={clear}
    />,
  )
  expect(screen.getByText('선택한 조절 · 코끝 위아래')).toBeVisible()
  const send = () => {
    fireEvent.change(screen.getByRole('textbox', { name: '원하는 변화' }), {
      target: { value: '여기만 조금 올려줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AI 실장님께 보내기' }))
  }
  send()
  await waitFor(() =>
    expect(chat.send).toHaveBeenCalledExactlyOnceWith('여기만 조금 올려줘', {
      directControl: { code: 'nose.tip_height', stateVersion: 3 },
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: '선택한 조절 지우기' }))
  expect(clear).toHaveBeenCalledOnce()
  rerender(<ConsultPanel consult={chat} catalog={null} />)
  send()
  expect(chat.send).toHaveBeenCalledTimes(1)
  expect(screen.getByText('직접 조절에서 상담할 항목을 먼저 골라 주세요.')).toBeVisible()
})
