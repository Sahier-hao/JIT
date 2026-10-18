/**
 * 可读性下限（IP-01）：正文与元信息文字的对比度不低于 4.5:1。
 *
 * 做法：从 tokens.css 解析出四套主题的**有效**令牌值（根层 + 主题覆盖），
 * 对实际会成对出现的"文字/背景"组合核算 WCAG 对比度。
 * 这里验证的是令牌契约；渲染后的像素由 e2e 的 accessibility 用例覆盖。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

const THEMES = ['concrete', 'steel', 'charcoal', 'paper'] as const

function blockBody(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`找不到选择器 ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function parse(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(match[1], match[2].trim())
  return map
}

const rootTokens = parse(blockBody(':root {'))

/** 取某套主题下的有效令牌：主题块覆盖根层。 */
function tokensFor(theme: string): Map<string, string> {
  if (theme === 'concrete') return new Map(rootTokens)
  return new Map([...rootTokens, ...parse(blockBody(`html[data-theme="${theme}"]`))])
}

function hex(value: string): { r: number; g: number; b: number } {
  const raw = value.replace('#', '')
  return { r: Number.parseInt(raw.slice(0, 2), 16), g: Number.parseInt(raw.slice(2, 4), 16), b: Number.parseInt(raw.slice(4, 6), 16) }
}

function luminance(value: string): number {
  const { r, g, b } = hex(value)
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function ratio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** 实际会成对出现的组合；名称只用于失败时定位。 */
const PAIRS: { name: string; fg: string; bg: string }[] = [
  { name: '正文 on 卡片', fg: 'fg-2', bg: 'card' },
  { name: '正文 on 画布', fg: 'fg-2', bg: 'canvas' },
  { name: '元信息 on 卡片', fg: 'fg-3', bg: 'card' },
  { name: '元信息 on 画布', fg: 'fg-3', bg: 'canvas' },
  { name: '元信息 on 下沉底', fg: 'fg-3', bg: 'sunken' },
  { name: '表格行内元信息 on 卡片', fg: 'fg-3', bg: 'card' },
  { name: '风险值 on 卡片', fg: 'risk-fg', bg: 'card' },
  { name: '强调文字 on 卡片', fg: 'accent', bg: 'card' },
  { name: '主按钮文字 on 强调底', fg: 'fg-inv', bg: 'accent' },
  { name: '标题 on 画布', fg: 'fg', bg: 'canvas' },
]

describe('对比度下限（IP-01）', () => {
  it.each(THEMES)('%s 主题下，全部代表性组合达到 4.5:1', (theme) => {
    const tokens = tokensFor(theme)
    const failures: string[] = []

    for (const pair of PAIRS) {
      const fg = tokens.get(pair.fg)
      const bg = tokens.get(pair.bg)
      expect(fg, `${theme} 缺少 --${pair.fg}`).toBeTruthy()
      expect(bg, `${theme} 缺少 --${pair.bg}`).toBeTruthy()

      const value = ratio(fg as string, bg as string)
      if (value < 4.5) failures.push(`${pair.name}: ${value.toFixed(2)}:1（--${pair.fg} on --${pair.bg}）`)
    }

    expect(failures).toEqual([])
  })

  it('低风险色阶不是绿色系（不暗示"已确认无缺陷"）', () => {
    for (const theme of THEMES) {
      const tokens = tokensFor(theme)
      for (const key of ['risk', 'risk-strong', 'risk-fg']) {
        const { r, g, b } = hex(tokens.get(key) as string)
        expect(r, `${theme} 的 --${key} 不是暖色相`).toBeGreaterThan(g)
        expect(r, `${theme} 的 --${key} 不是暖色相`).toBeGreaterThan(b)
      }
    }
  })
})
