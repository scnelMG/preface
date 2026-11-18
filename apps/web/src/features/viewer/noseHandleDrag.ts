import type { NoseHandleControl } from './types'

const PIXELS_PER_RANGE = 180

export function nearestNoseHandle(
  handles: readonly { id: string; x: number; y: number }[],
  x: number,
  y: number,
) {
  return (
    handles.reduce<{ id: string; distance: number } | null>((nearest, handle) => {
      const distance = (handle.x - x) ** 2 + (handle.y - y) ** 2
      return !nearest || distance < nearest.distance ? { id: handle.id, distance } : nearest
    }, null)?.id ?? null
  )
}

export function dragNoseHandle(
  handles: readonly { id: string; x: number; y: number; width: number; height: number }[],
  selected: string | null,
  x: number,
  y: number,
) {
  // 가까운 두 점이 겹쳐도 먼저 고른 점 안에서 시작한 드래그는 그 점에 남긴다.
  const current = handles.find((handle) => handle.id === selected)
  if (
    current &&
    Math.abs(current.x - x) <= current.width / 2 &&
    Math.abs(current.y - y) <= current.height / 2
  )
    return current.id
  return nearestNoseHandle(handles, x, y)
}

export function controlsForHandle(
  handle: string,
  controls: readonly NoseHandleControl[],
  rightX: number,
  rightZ: number,
) {
  const ids =
    handle === 'nasion'
      ? ['bridge']
      : handle === 'pronasale'
        ? Math.abs(rightZ) > 0.2
          ? ['projection', 'lower']
          : ['lower']
        : Math.abs(rightX) > 0.2
          ? ['alar']
          : []
  return controls.filter((control) => ids.includes(control.id) && !control.unavailable)
}

/** 손잡이는 코 효과의 표시 범위만 움직인다. 형상과 저장 검사는 기존 슬라이더 경로가 맡는다. */
export function noseHandleDragChanges(
  handle: string,
  controls: readonly NoseHandleControl[],
  dx: number,
  dy: number,
  rightX: number,
  rightZ: number,
) {
  return controlsForHandle(handle, controls, rightX, rightZ).map((control) => {
    const offset =
      control.id === 'bridge'
        ? -dy
        : control.id === 'lower'
          ? dy
          : control.id === 'projection'
            ? dx * Math.sign(rightZ)
            : dx * Math.sign(rightX) * (handle.endsWith('left') ? 1 : -1)
    const rounded = Math.max(
      -1,
      Math.min(1, Math.round((control.value + offset / PIXELS_PER_RANGE) * 100) / 100),
    )
    return {
      id: control.id,
      value: rounded === Math.round(control.value * 100) / 100 ? control.value : rounded,
    }
  })
}

const DIRECTION_LABELS = {
  bridge: ['낮게', '높게'],
  projection: ['뒤로', '앞으로'],
  lower: ['올리기', '내리기'],
  alar: ['좁게', '넓게'],
} as const

/** 실제 드래그 계산을 기준으로, 현재 시점과 범위에서 움직일 수 있는 방향만 안내한다. */
export function noseHandleDirectionHints(
  handle: string,
  controls: readonly NoseHandleControl[],
  rightX: number,
  rightZ: number,
) {
  const directions = [
    { key: 'up', arrow: '↑', dx: 0, dy: -18 },
    { key: 'right', arrow: '→', dx: 18, dy: 0 },
    { key: 'down', arrow: '↓', dx: 0, dy: 18 },
    { key: 'left', arrow: '←', dx: -18, dy: 0 },
  ] as const
  return directions.flatMap(({ key, arrow, dx, dy }) => {
    const changed = noseHandleDragChanges(handle, controls, dx, dy, rightX, rightZ).find(
      ({ id, value }) => value !== controls.find((control) => control.id === id)?.value,
    )
    if (!changed) return []
    const labels = DIRECTION_LABELS[changed.id]
    return [
      {
        key,
        arrow,
        label:
          labels[
            changed.value > (controls.find((control) => control.id === changed.id)?.value ?? 0)
              ? 1
              : 0
          ],
      },
    ]
  })
}
