/**
 * 디자인 토큰 이름 목록 — tokens.css와 같은 원본(Figma Foundations · v3)에서 만들었다.
 * 확인용 페이지와 테스트가 쓴다. Figma 값이 바뀌면 tokens.css와 같이 고친다.
 */

/** Figma 색 변수 29개 (CSS 변수 이름 = Figma 변수 이름) */
export const COLOR_TOKENS = [
  { name: 'v3-bg-paper', value: '#faf9f7' },
  { name: 'v3-bg-canvas', value: '#faf9f6' },
  { name: 'v3-bg-card', value: '#faf8f4' },
  { name: 'v3-bg-warm', value: '#f6f3ed' },
  { name: 'v3-bg-stone', value: '#f0ece5' },
  { name: 'v3-bg-cream', value: '#fffefa' },
  { name: 'v3-bg-surface', value: '#ffffff' },
  { name: 'v3-line-default', value: '#e5e3de' },
  { name: 'v3-line-stone', value: '#e3dcd1' },
  { name: 'v3-line-warm', value: '#e2ddd4' },
  { name: 'v3-line-sand', value: '#e1d9ce' },
  { name: 'v3-text-ink', value: '#1a1a18' },
  { name: 'v3-text-muted', value: '#8d8d85' },
  { name: 'v3-text-body', value: '#73736d' },
  { name: 'v3-text-paragraph', value: '#76766f' },
  { name: 'v3-text-stone', value: '#897e70' },
  { name: 'v3-text-sand', value: '#a39887' },
  { name: 'v3-text-on-dark', value: '#ffffff' },
  { name: 'v3-brand-violet', value: '#8655cc' },
  { name: 'v3-brand-violet-deep', value: '#76529e' },
  { name: 'v3-brand-violet-ink', value: '#79579e' },
  { name: 'v3-brand-violet-text', value: '#725293' },
  { name: 'v3-brand-violet-soft', value: '#9068c3' },
  { name: 'v3-brand-lavender', value: '#c9acef' },
  { name: 'v3-brand-lavender-soft', value: '#f0e9f8' },
  { name: 'v3-brand-lavender-tint', value: '#f3edf9' },
  { name: 'v3-brand-lavender-line', value: '#d6c7e7' },
  { name: 'v3-neutral-charcoal', value: '#252129' },
  { name: 'v3-overlay-scrim', value: '#171915' },
] as const

/** v3.2에서 추가된 색. Figma 이름은 Color/status/danger */
export const STATUS_DANGER = { name: 'color-status-danger', value: '#b42318' } as const

/** Figma 타입 스타일 51개. className = type-<Figma 이름에서 만든 이름> */
export const TYPE_TOKENS = [
  { figma: 'v3/EN/Body 12 Regular · lh15.6', className: 'type-en-body-12-regular-lh15p6' },
  {
    figma: 'v3/EN/Caption 10 Medium · ls1.8 · lh13',
    className: 'type-en-caption-10-medium-ls1p8-lh13',
  },
  { figma: 'v3/EN/Caption 10 Regular · lh13', className: 'type-en-caption-10-regular-lh13' },
  { figma: 'v3/EN/Caption 11 Regular · lh14.3', className: 'type-en-caption-11-regular-lh14p3' },
  { figma: 'v3/EN/Caption 11 Regular · lh16.5', className: 'type-en-caption-11-regular-lh16p5' },
  {
    figma: 'v3/EN/Caption 9 Medium · ls1.6 · lh11.7',
    className: 'type-en-caption-9-medium-ls1p6-lh11p7',
  },
  { figma: 'v3/EN/Caption 9 Regular · lh11.7', className: 'type-en-caption-9-regular-lh11p7' },
  { figma: 'v3/EN/Caption 9 Regular · lh13.5', className: 'type-en-caption-9-regular-lh13p5' },
  {
    figma: 'v3/EN/Caption 9 Regular · ls1 · lh11.7',
    className: 'type-en-caption-9-regular-ls1-lh11p7',
  },
  {
    figma: 'v3/EN/Caption 9 Regular · ls1.5 · lh11.7',
    className: 'type-en-caption-9-regular-ls1p5-lh11p7',
  },
  {
    figma: 'v3/EN/Micro 6 Regular · ls0.7 · lh10.8',
    className: 'type-en-micro-6-regular-ls0p7-lh10p8',
  },
  { figma: 'v3/EN/Micro 6 Regular · ls1 · lh7.8', className: 'type-en-micro-6-regular-ls1-lh7p8' },
  {
    figma: 'v3/EN/Micro 7 Regular · ls0.7 · lh12.6',
    className: 'type-en-micro-7-regular-ls0p7-lh12p6',
  },
  { figma: 'v3/EN/Micro 8 Medium · ls1 · lh10.4', className: 'type-en-micro-8-medium-ls1-lh10p4' },
  {
    figma: 'v3/EN/Micro 8 Medium · ls1.3 · lh10.4',
    className: 'type-en-micro-8-medium-ls1p3-lh10p4',
  },
  {
    figma: 'v3/EN/Micro 8 Medium · ls1.8 · lh10.4',
    className: 'type-en-micro-8-medium-ls1p8-lh10p4',
  },
  {
    figma: 'v3/EN/Micro 8 Regular · ls1 · lh10.4',
    className: 'type-en-micro-8-regular-ls1-lh10p4',
  },
  { figma: 'v3/EN/Micro 8 Regular · ls1 · lh16', className: 'type-en-micro-8-regular-ls1-lh16' },
  { figma: 'v3/EN/Title 26 Bold · ls-2 · lh26', className: 'type-en-title-26-bold-ls-2-lh26' },
  { figma: 'v3/EN/Title 34 Bold · ls-2.7 · lh34', className: 'type-en-title-34-bold-ls-2p7-lh34' },
  { figma: 'v3/KR/Body 12 Medium · lh15.6', className: 'type-kr-body-12-medium-lh15p6' },
  { figma: 'v3/KR/Body 12 Medium · lh19.2', className: 'type-kr-body-12-medium-lh19p2' },
  { figma: 'v3/KR/Body 12 Regular · lh15.6', className: 'type-kr-body-12-regular-lh15p6' },
  { figma: 'v3/KR/Body 12 Regular · lh22.2', className: 'type-kr-body-12-regular-lh22p2' },
  { figma: 'v3/KR/Body 12 Regular · lh22.8', className: 'type-kr-body-12-regular-lh22p8' },
  { figma: 'v3/KR/Body 13 Medium · lh16.9', className: 'type-kr-body-13-medium-lh16p9' },
  { figma: 'v3/KR/Body 13 Regular · lh16.9', className: 'type-kr-body-13-regular-lh16p9' },
  { figma: 'v3/KR/Body 14 Medium · lh18.2', className: 'type-kr-body-14-medium-lh18p2' },
  { figma: 'v3/KR/Caption 10 Medium · lh13', className: 'type-kr-caption-10-medium-lh13' },
  { figma: 'v3/KR/Caption 10 Medium · lh18', className: 'type-kr-caption-10-medium-lh18' },
  { figma: 'v3/KR/Caption 10 Regular · lh13', className: 'type-kr-caption-10-regular-lh13' },
  { figma: 'v3/KR/Caption 10 Regular · lh19', className: 'type-kr-caption-10-regular-lh19' },
  { figma: 'v3/KR/Caption 10 Regular · lh20', className: 'type-kr-caption-10-regular-lh20' },
  { figma: 'v3/KR/Caption 11 Medium · lh14.3', className: 'type-kr-caption-11-medium-lh14p3' },
  { figma: 'v3/KR/Caption 11 Regular · lh14.3', className: 'type-kr-caption-11-regular-lh14p3' },
  { figma: 'v3/KR/Caption 11 Regular · lh16.5', className: 'type-kr-caption-11-regular-lh16p5' },
  { figma: 'v3/KR/Caption 11 Regular · lh20.8', className: 'type-kr-caption-11-regular-lh20p8' },
  { figma: 'v3/KR/Caption 11 Regular · lh20.9', className: 'type-kr-caption-11-regular-lh20p9' },
  { figma: 'v3/KR/Caption 9 Regular · lh11.7', className: 'type-kr-caption-9-regular-lh11p7' },
  { figma: 'v3/KR/Caption 9 Regular · lh13.5', className: 'type-kr-caption-9-regular-lh13p5' },
  { figma: 'v3/KR/Caption 9 Regular · lh14.4', className: 'type-kr-caption-9-regular-lh14p4' },
  { figma: 'v3/KR/Caption 9 Regular · lh16.2', className: 'type-kr-caption-9-regular-lh16p2' },
  { figma: 'v3/KR/Caption 9 Regular · lh17.1', className: 'type-kr-caption-9-regular-lh17p1' },
  {
    figma: 'v3/KR/Caption 9 Regular · ls0.8 · lh11.7',
    className: 'type-kr-caption-9-regular-ls0p8-lh11p7',
  },
  {
    figma: 'v3/KR/Heading 15 Medium · ls-0.5 · lh19.5',
    className: 'type-kr-heading-15-medium-ls-0p5-lh19p5',
  },
  { figma: 'v3/KR/Micro 7 Regular · lh14', className: 'type-kr-micro-7-regular-lh14' },
  { figma: 'v3/KR/Micro 8 Regular · lh10.4', className: 'type-kr-micro-8-regular-lh10p4' },
  { figma: 'v3/KR/Micro 8 Regular · lh12', className: 'type-kr-micro-8-regular-lh12' },
  { figma: 'v3/KR/Micro 8 Regular · lh14.4', className: 'type-kr-micro-8-regular-lh14p4' },
  {
    figma: 'v3/KR/Title 22 Medium · ls-1 · lh28.6',
    className: 'type-kr-title-22-medium-ls-1-lh28p6',
  },
  {
    figma: 'v3/KR/Title 23 Regular · ls-1.3 · lh34.5',
    className: 'type-kr-title-23-regular-ls-1p3-lh34p5',
  },
] as const
