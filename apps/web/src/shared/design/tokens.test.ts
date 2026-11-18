// @vitest-environment node
// DOM이 필요 없고, jsdom에서는 import.meta.url이 file:// 경로가 아니다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLOR_TOKENS, STATUS_DANGER, TYPE_TOKENS } from './tokens'

// 이슈 S15P31B204-272 완료 조건 1: 색·타입 토큰이 Figma Variables와 같은 이름·값이다.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')

describe('디자인 토큰 (Figma Foundations · v3)', () => {
  it('색 29개, 타입 51개 — Figma와 개수가 같다', () => {
    expect(COLOR_TOKENS).toHaveLength(29)
    expect(TYPE_TOKENS).toHaveLength(51)
  })

  it('색 변수 이름·값이 CSS에 그대로 있다', () => {
    for (const { name, value } of [...COLOR_TOKENS, STATUS_DANGER]) {
      expect(css).toContain(`--${name}: ${value};`)
    }
  })

  it('타입 51개가 모두 유틸리티로 있다', () => {
    for (const { className } of TYPE_TOKENS) {
      expect(css).toContain(`@utility ${className} {`)
    }
  })

  it('타입 이름은 Figma 이름에서 규칙대로 만든다 (줄 간격은 이름의 소수 값)', () => {
    const body13 = TYPE_TOKENS.find((t) => t.figma === 'v3/KR/Body 13 Regular · lh16.9')
    expect(body13?.className).toBe('type-kr-body-13-regular-lh16p9')
    expect(css).toMatch(
      /@utility type-kr-body-13-regular-lh16p9 \{\s*font-size: 13px;\s*line-height: 16.9px;\s*font-weight: 400;\s*\}/,
    )
  })

  it('Tailwind 기본 팔레트를 꺼서 토큰 밖의 색을 막는다', () => {
    expect(css).toContain('--color-*: initial;')
  })
})
