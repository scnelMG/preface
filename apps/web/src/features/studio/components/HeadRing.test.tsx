import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import { getFaceModel } from '../api'
import { buildHeadOptions } from '../heads'
import { HeadRing } from './HeadRing'
import type { CenterZone, RingItem } from './HeadRingScene'

// 3D 장면 대신 받은 칸만 적어 둔다(jsdom에는 WebGL이 없다)
vi.mock('next/dynamic', () => ({
  default: () =>
    function SceneStub({
      items,
      onPick,
      centerZone,
    }: {
      items: readonly RingItem[]
      onPick: (slot: number, clientX: number, clientY: number) => void
      centerZone: MutableRefObject<CenterZone | null>
    }) {
      sceneZone = centerZone
      return (
        <ul aria-label="고리 칸">
          {items.map((item, slot) => (
            <li key={item.key} onClick={(event) => onPick(slot, event.clientX, event.clientY)}>
              {item.url}
            </li>
          ))}
        </ul>
      )
    },
}))
vi.mock('../api', () => ({ getFaceModel: vi.fn(() => new Promise(() => {})) }))
let sceneZone: MutableRefObject<CenterZone | null> | null = null

const getContext = HTMLCanvasElement.prototype.getContext
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    getExtension: () => null,
  })) as unknown as typeof getContext
})
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = getContext
})

describe('HeadRing (-527)', () => {
  it('기본 모델이 둘이면 칸도 둘이다(같은 머리를 반복해 넷 칸으로 놓지 않는다)', () => {
    const options = buildHeadOptions([])
    render(<HeadRing options={options} index={0} onSelect={() => {}} fallback={null} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.textContent)).toEqual([
      '/models/base-male.glb',
      '/models/base-female.glb',
    ])
  })

  it('가운데 머리를 누르면 편집하기(onOpen), 옆 머리를 누르면 그 머리로 돌린다(-605)', () => {
    const options = buildHeadOptions([])
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <HeadRing options={options} index={0} onSelect={onSelect} onOpen={onOpen} fallback={null} />,
    )
    const [center, side] = screen.getAllByRole('listitem')

    fireEvent.click(center)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(side)
    expect(onSelect).toHaveBeenCalledWith(options[1].id)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('기본 모델 GLB를 장면 코드보다 먼저 받기 시작한다', () => {
    render(
      <HeadRing options={buildHeadOptions([])} index={0} onSelect={() => {}} fallback={null} />,
    )

    const links = [...document.head.querySelectorAll('link[rel="preload"][as="fetch"]')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/models/base-male.glb', '/models/base-female.glb']),
    )
  })

  it('가운데 누르기 구역 안이면 옆 머리에 닿아도 돌리지 않고 들어간다(-799)', () => {
    const options = buildHeadOptions([])
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <HeadRing options={options} index={0} onSelect={onSelect} onOpen={onOpen} fallback={null} />,
    )
    // 가운데 머리가 고개를 좌우 끝까지 돌릴 때의 범위(jsdom의 고리 위치는 0,0)
    sceneZone!.current = { left: 100, right: 300, top: 0, bottom: 400 }
    const [, side] = screen.getAllByRole('listitem')

    fireEvent.click(side, { clientX: 290, clientY: 200 })
    expect(onSelect).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledTimes(1)

    // 구역 밖의 옆 머리는 지금처럼 가운데로 돌린다
    fireEvent.click(side, { clientX: 420, clientY: 200 })
    expect(onSelect).toHaveBeenCalledWith(options[1].id)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('내 모델 메시 주소는 머리마다 한 번만 부른다(하나가 도착해도 나머지를 다시 부르지 않는다, -799)', async () => {
    const resolvers = new Map<string, (detail: { meshUrl: string }) => void>()
    vi.mocked(getFaceModel).mockImplementation(
      (id: string) =>
        new Promise((resolve) => resolvers.set(id, resolve as never)) as ReturnType<
          typeof getFaceModel
        >,
    )
    const models = ['a', 'b', 'c'].map((id) => ({
      faceModelId: id,
      title: id,
      createdAt: '2026-11-01T00:00:00Z',
      thumbnailUrl: null,
      simulationCount: 0,
    }))
    render(
      <HeadRing
        options={buildHeadOptions(models, [])}
        index={0}
        onSelect={() => {}}
        fallback={null}
      />,
    )
    expect(vi.mocked(getFaceModel)).toHaveBeenCalledTimes(3)

    await act(async () => resolvers.get('a')!({ meshUrl: 'https://s3.test/a.glb' }))
    await act(async () => resolvers.get('b')!({ meshUrl: 'https://s3.test/b.glb' }))
    expect(vi.mocked(getFaceModel)).toHaveBeenCalledTimes(3)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'https://s3.test/a.glb',
      'https://s3.test/b.glb',
      '',
    ])
  })
})
