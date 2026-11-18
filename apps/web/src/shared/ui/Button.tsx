import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

/**
 * Figma `v3/Button` (Foundations · v3). Type × Layout 조합은 Figma에 있는 것만 받는다.
 *
 * | variant   | layout                          |
 * | --------- | ------------------------------- |
 * | primary   | wrapped, inline                 |
 * | ink       | wrapped, inline                 |
 * | violet    | wrapped                         |
 * | secondary | wrapped, inline, icon-first     |
 * | quiet     | inline, spread                  |
 * | text      | wrapped, inline                 |
 * | icon      | icon-only                       |
 * | danger    | wrapped                         |
 *
 * 아이콘 기본값도 Figma variant 그대로다. 바꾸려면 leadingIcon·trailingIcon을 넘기고, 빼려면 null.
 * 색은 버튼에 한 번만 준다. 아이콘은 currentColor라 글자 색을 따른다(Figma도 같은 색).
 * Figma에 hover·disabled 상태가 없다. disabled만 접근성용으로 흐리게 처리한다.
 */
type TextVariantLayout =
  | { variant: 'primary'; layout?: 'wrapped' | 'inline' }
  | { variant: 'ink'; layout?: 'wrapped' | 'inline' }
  | { variant: 'violet'; layout?: 'wrapped' }
  | { variant: 'secondary'; layout?: 'wrapped' | 'inline' | 'icon-first' }
  | { variant: 'quiet'; layout?: 'inline' | 'spread' }
  | { variant: 'text'; layout?: 'wrapped' | 'inline' }
  | { variant: 'danger'; layout?: 'wrapped' }

export type ButtonVariant = TextVariantLayout['variant'] | 'icon'
export type ButtonLayout = NonNullable<TextVariantLayout['layout']> | 'icon-only'

const DEFAULT_LAYOUT: Record<ButtonVariant, ButtonLayout> = {
  primary: 'wrapped',
  ink: 'wrapped',
  violet: 'wrapped',
  secondary: 'wrapped',
  quiet: 'inline',
  text: 'wrapped',
  icon: 'icon-only',
  danger: 'wrapped',
}

interface Spec {
  /** 크기·여백·배경·테두리 */
  box: string
  /** 글자와 아이콘 색 */
  color: string
  /** 글꼴 크기·줄 간격·굵기 */
  type: string
  iconSize: number
  leading?: IconName
  trailing?: IconName
  /** 가운데를 비워 아이콘을 양 끝으로 민다(quiet/spread) */
  spacer?: boolean
}

// 값은 Figma get_design_context 결과 그대로다.
// 토큰이 아닌 색(#20182b, #d4d2cc)은 Figma에서도 변수로 묶여 있지 않다.
// v4(2026-10-30): 48px 알약. 잉크·보조·위험 버튼이 디자인 시스템 btn-primary/btn-ghost와 같은 모양이 된다
const SIZE_48 =
  'h-[48px] gap-(--space-8) px-(--space-22) rounded-full justify-center transition-[transform,background-color] duration-(--pf-dur-press) ease-(--pf-ease-out) active:enabled:scale-[0.97]'
const V4_LABEL = 'text-[15px] leading-none font-medium tracking-[-0.01em]'
const PRIMARY =
  'h-[52px] justify-between px-[21px] py-(--space-16) rounded-7 border border-brand-lavender bg-brand-lavender shadow-[0_4px_6px_rgba(0,0,0,0.05)]'

const SPECS: Partial<Record<`${ButtonVariant}/${ButtonLayout}`, Spec>> = {
  'primary/wrapped': {
    box: `${PRIMARY} min-w-[174px] items-center`,
    color: 'text-[#20182b]',
    type: 'text-[13px] leading-[17px] font-bold',
    iconSize: 20,
    trailing: 'ArrowRight',
  },
  'primary/inline': {
    box: `${PRIMARY} min-w-[170px] items-end`,
    color: 'text-[#20182b]',
    type: 'text-[12px] leading-[16px] font-bold',
    iconSize: 20,
    trailing: 'ArrowRight',
  },
  'ink/wrapped': {
    box: `${SIZE_48} items-center border border-ink bg-ink hover:bg-[oklch(0.28_0.01_286)]`,
    color: 'text-on-ink',
    type: V4_LABEL,
    iconSize: 20,
    trailing: 'ArrowRight',
  },
  'ink/inline': {
    box: `${SIZE_48} items-center border border-ink bg-ink hover:bg-[oklch(0.28_0.01_286)]`,
    color: 'text-on-ink',
    type: V4_LABEL,
    iconSize: 20,
    trailing: 'ArrowRight',
  },
  'violet/wrapped': {
    box: 'h-[42px] min-w-[146.5px] items-center justify-between px-[15px] py-[11px] rounded-7 border border-brand-violet-deep bg-brand-violet-deep',
    color: 'text-text-on-dark',
    type: 'type-kr-caption-11-medium-lh14p3',
    iconSize: 20,
    trailing: 'ArrowRight',
  },
  'secondary/wrapped': {
    box: `${SIZE_48} items-center border border-hairline-strong hover:bg-surface/60`,
    color: 'text-ink',
    type: V4_LABEL,
    iconSize: 20,
    trailing: 'Check',
  },
  'secondary/inline': {
    box: `${SIZE_48} items-center border border-hairline-strong hover:bg-surface/60`,
    color: 'text-ink',
    type: V4_LABEL,
    iconSize: 20,
    trailing: 'Check',
  },
  'secondary/icon-first': {
    box: `${SIZE_48} items-center border border-hairline-strong hover:bg-surface/60`,
    color: 'text-ink',
    type: V4_LABEL,
    iconSize: 20,
    leading: 'SignOut',
  },
  'quiet/inline': {
    box: 'items-center gap-(--space-10) py-(--space-8)',
    color: 'text-text-ink',
    type: 'text-[12px] leading-[18px] font-normal',
    iconSize: 24,
    trailing: 'ArrowRight',
  },
  'quiet/spread': {
    box: 'w-full h-[32.5px] items-center gap-(--space-7) pt-[7.7px] pb-[8.3px]',
    color: 'text-text-ink',
    type: 'text-[11px] leading-[17px] font-medium',
    iconSize: 16,
    leading: 'Plus',
    trailing: 'ArrowRight',
    spacer: true,
  },
  'text/wrapped': {
    box: 'h-[30px] items-center gap-[3px] p-(--space-7) rounded-6 bg-brand-lavender-soft',
    color: 'text-brand-violet-ink',
    type: 'type-kr-caption-10-regular-lh13',
    iconSize: 13,
    trailing: 'ArrowRight',
  },
  'text/inline': {
    box: 'h-[36px] items-center gap-(--space-10) px-[13px] pt-(--space-10) pb-[9.2px] rounded-6 bg-brand-lavender-soft',
    color: 'text-brand-violet-ink',
    type: 'type-kr-body-12-regular-lh15p6',
    iconSize: 16,
    trailing: 'ArrowRight',
  },
  'icon/icon-only': {
    box: 'size-[40px] items-center justify-center rounded-full transition-colors duration-(--pf-dur-ui) hover:bg-ink/5',
    color: 'text-ink',
    type: '',
    iconSize: 19,
  },
  'danger/wrapped': {
    box: `${SIZE_48} items-center border border-transparent bg-(--pf-danger)`,
    color: 'text-on-ink',
    type: V4_LABEL,
    iconSize: 20,
    trailing: 'ArrowRight',
  },
}

export function buttonSpec(variant: ButtonVariant, layout?: ButtonLayout): Spec {
  const key = `${variant}/${layout ?? DEFAULT_LAYOUT[variant]}` as const
  const spec = SPECS[key]
  if (!spec) throw new Error(`Figma v3/Button에 없는 조합이다: ${key}`)
  return spec
}

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** 넘기면 next/link로 그린다 */
  href?: string
}

export type TextButtonProps = NativeProps &
  TextVariantLayout & {
    children: ReactNode
    /** null이면 아이콘을 뺀다. 생략하면 Figma variant의 아이콘 */
    leadingIcon?: IconName | null
    trailingIcon?: IconName | null
  }

export type IconButtonProps = NativeProps & {
  variant: 'icon'
  layout?: 'icon-only'
  /** 기본 X */
  icon?: IconName
  /** 아이콘만 있는 버튼은 이름이 반드시 필요하다 */
  'aria-label': string
}

export type ButtonProps = TextButtonProps | IconButtonProps

function renderContent(props: ButtonProps, spec: Spec): ReactNode {
  if (props.variant === 'icon') {
    return <Icon name={props.icon ?? 'X'} size={spec.iconSize} />
  }
  const leading = props.leadingIcon === undefined ? spec.leading : props.leadingIcon
  const trailing = props.trailingIcon === undefined ? spec.trailing : props.trailingIcon
  return (
    <>
      {leading ? <Icon name={leading} size={spec.iconSize} className="shrink-0" /> : null}
      <span className={cx('whitespace-nowrap', spec.type)}>{props.children}</span>
      {spec.spacer ? <span aria-hidden className="flex-1" /> : null}
      {trailing ? <Icon name={trailing} size={spec.iconSize} className="shrink-0" /> : null}
    </>
  )
}

export function Button(props: ButtonProps) {
  const spec = buttonSpec(props.variant, props.layout)
  const content = renderContent(props, spec)
  const classes = cx(
    'relative inline-flex shrink-0 text-center',
    spec.box,
    spec.color,
    'disabled:cursor-not-allowed disabled:opacity-40',
    // 누르는 순간 살짝 눌린다(160ms ease-out). 동작 줄이기 설정이면 움직이지 않는다
    'transition-transform duration-150 ease-out active:scale-[0.97] disabled:active:scale-100 motion-reduce:active:scale-100',
    props.className,
  )

  if (props.href) {
    return (
      <Link href={props.href} className={classes} aria-label={props['aria-label']}>
        {content}
      </Link>
    )
  }

  return (
    <button {...nativeProps(props)} type={props.type ?? 'button'} className={classes}>
      {content}
    </button>
  )
}

/** Button이 직접 쓰는 props. 나머지(onClick, disabled, aria-* …)는 <button>에 그대로 넘긴다 */
const OWN_PROPS = new Set([
  'variant',
  'layout',
  'href',
  'className',
  'type',
  'children',
  'leadingIcon',
  'trailingIcon',
  'icon',
])

function nativeProps(props: ButtonProps): ButtonHTMLAttributes<HTMLButtonElement> {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !OWN_PROPS.has(key)))
}
