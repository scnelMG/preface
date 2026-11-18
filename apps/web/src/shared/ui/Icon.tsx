import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BellIcon,
  CalculatorIcon,
  CameraIcon,
  ArrowsClockwiseIcon,
  ArrowsOutCardinalIcon,
  MagnifyingGlassPlusIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  CompassIcon,
  CubeIcon,
  DotsThreeIcon,
  EyeglassesIcon,
  FloppyDiskIcon,
  ImageIcon,
  InfoIcon,
  LightbulbIcon,
  ListChecksIcon,
  ListIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ScanIcon,
  ScissorsIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SlidersHorizontalIcon,
  SmileyIcon,
  SparkleIcon,
  SquaresFourIcon,
  StackIcon,
  TrashIcon,
  UploadSimpleIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from '@phosphor-icons/react/ssr'
// 타입만 가져온다. ssr 진입점에는 Icon 타입이 없다
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'

/**
 * Figma Foundations · v3 `Icons`(63개) + `v3/Icon/Bell-regular`.
 * 이름과 굵기 조합은 Figma에 있는 것만 받는다. 없는 조합을 쓰면 타입 에러가 난다.
 * 첫 번째 굵기가 기본값이다.
 *
 * `@phosphor-icons/react/ssr`에서 가져온다. 서버 컴포넌트에서도 쓸 수 있다.
 * 색은 currentColor라 글자 색을 따른다(Figma도 아이콘 색 = 같은 요소의 글자 색).
 */
const ICONS = {
  ArrowCounterClockwise: { component: ArrowCounterClockwiseIcon, weights: ['regular'] },
  ArrowLeft: { component: ArrowLeftIcon, weights: ['regular'] },
  ArrowRight: { component: ArrowRightIcon, weights: ['regular'] },
  ArrowUpRight: { component: ArrowUpRightIcon, weights: ['regular'] },
  Bell: { component: BellIcon, weights: ['regular'] },
  Calculator: { component: CalculatorIcon, weights: ['regular', 'light'] },
  Camera: { component: CameraIcon, weights: ['regular', 'light'] },
  CaretLeft: { component: CaretLeftIcon, weights: ['regular'] },
  CaretRight: { component: CaretRightIcon, weights: ['regular'] },
  ChatCircleText: { component: ChatCircleTextIcon, weights: ['regular', 'light'] },
  Check: { component: CheckIcon, weights: ['regular'] },
  CheckCircle: { component: CheckCircleIcon, weights: ['regular', 'thin'] },
  Clock: { component: ClockIcon, weights: ['regular'] },
  ClockCounterClockwise: {
    component: ClockCounterClockwiseIcon,
    weights: ['regular', 'light', 'thin'],
  },
  Compass: { component: CompassIcon, weights: ['regular', 'light'] },
  Cube: { component: CubeIcon, weights: ['regular', 'light', 'thin'] },
  DotsThree: { component: DotsThreeIcon, weights: ['regular'] },
  Eyeglasses: { component: EyeglassesIcon, weights: ['regular', 'light'] },
  FloppyDisk: { component: FloppyDiskIcon, weights: ['regular'] },
  Image: { component: ImageIcon, weights: ['regular', 'light'] },
  Info: { component: InfoIcon, weights: ['regular'] },
  Lightbulb: { component: LightbulbIcon, weights: ['regular'] },
  List: { component: ListIcon, weights: ['regular'] },
  ListChecks: { component: ListChecksIcon, weights: ['regular', 'light'] },
  MagicWand: { component: MagicWandIcon, weights: ['regular', 'light'] },
  MagnifyingGlass: { component: MagnifyingGlassIcon, weights: ['regular'] },
  PaintBrush: { component: PaintBrushIcon, weights: ['regular', 'light'] },
  Pause: { component: PauseIcon, weights: ['fill'] },
  Play: { component: PlayIcon, weights: ['fill'] },
  Plus: { component: PlusIcon, weights: ['regular'] },
  Scan: { component: ScanIcon, weights: ['regular', 'light'] },
  Scissors: { component: ScissorsIcon, weights: ['regular', 'light'] },
  ShieldCheck: { component: ShieldCheckIcon, weights: ['regular'] },
  SignOut: { component: SignOutIcon, weights: ['regular'] },
  SlidersHorizontal: { component: SlidersHorizontalIcon, weights: ['regular'] },
  Smiley: { component: SmileyIcon, weights: ['regular', 'light'] },
  Sparkle: { component: SparkleIcon, weights: ['fill'] },
  // 3D 조작 안내(2026-10-30): 회전 · 확대 · 이동
  ArrowsClockwise: { component: ArrowsClockwiseIcon, weights: ['regular'] },
  ArrowsOutCardinal: { component: ArrowsOutCardinalIcon, weights: ['regular'] },
  MagnifyingGlassPlus: { component: MagnifyingGlassPlusIcon, weights: ['regular'] },
  SquaresFour: { component: SquaresFourIcon, weights: ['regular'] },
  Stack: { component: StackIcon, weights: ['regular', 'light'] },
  Trash: { component: TrashIcon, weights: ['regular'] },
  // Figma 아이콘 세트에는 없다. 작업실 모델 이름 바꾸기 버튼에 쓴다(-416)
  PencilSimple: { component: PencilSimpleIcon, weights: ['regular'] },
  // 상담 메시지 보내기(2026-10-30)
  PaperPlaneTilt: { component: PaperPlaneTiltIcon, weights: ['regular', 'fill'] },
  UploadSimple: { component: UploadSimpleIcon, weights: ['regular'] },
  User: { component: UserIcon, weights: ['regular', 'light'] },
  Users: { component: UsersIcon, weights: ['regular', 'light'] },
  X: { component: XIcon, weights: ['regular'] },
} as const satisfies Record<string, { component: PhosphorIcon; weights: readonly string[] }>

export type IconName = keyof typeof ICONS
export type IconWeight<N extends IconName> = (typeof ICONS)[N]['weights'][number]

export const ICON_NAMES = Object.keys(ICONS) as IconName[]

export function iconWeights<N extends IconName>(name: N): readonly IconWeight<N>[] {
  return ICONS[name].weights
}

export interface IconProps<N extends IconName> {
  name: N
  weight?: IconWeight<N>
  /** 한 변 길이(px). 기본 24 — Figma 아이콘 컴포넌트 크기 */
  size?: number
  className?: string
  /** 의미가 있는 아이콘이면 넣는다. 없으면 장식으로 보고 스크린 리더에서 숨긴다 */
  label?: string
}

export function Icon<N extends IconName>({
  name,
  weight,
  size = 24,
  className,
  label,
}: IconProps<N>) {
  const { component: Component, weights } = ICONS[name]
  return (
    <Component
      size={size}
      weight={weight ?? weights[0]}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
