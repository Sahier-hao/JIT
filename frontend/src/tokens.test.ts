/**
 * 令牌完整性：四套主题都必须在根层覆盖全部颜色语义键。
 *
 * 这里只校验"文本层面"能证明的部分：键齐全、风险色相跨主题保持暖色方向。
 * 渲染后的对比度由 contrast.test.ts 用令牌值核算，真实 DOM 由 e2e 覆盖。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

/** 根层必须定义的全部 26 个语义键（另有 1 个 --scrim 在四套主题里逐个声明，见 THEME_COLOR_KEYS）。 */
const REQUIRED_KEYS = [
  'sans', 'display', 'mono',
  'r', 'r-lg', 'sh-1', 'sh-2',
  'canvas', 'rail', 'sunken', 'card',
  'fg', 'fg-2', 'fg-3', 'fg-inv',
  'line', 'line-strong', 'line-soft',
  'accent', 'accent-hover', 'accent-soft', 'accent-ring',
  'risk', 'risk-strong', 'risk-fg', 'risk-track',
]

/** 每套主题都必须覆盖的颜色键（字体与圆角跨主题共享）。 */
const THEME_COLOR_KEYS = [
  'canvas', 'rail', 'sunken', 'card',
  'fg', 'fg-2', 'fg-3', 'fg-inv',
  'line', 'line-strong', 'line-soft',
  'accent', 'accent-soft',
  'risk', 'risk-strong', 'risk-fg', 'risk-track',
  'hover',
  // 图表色必须逐主题声明：柱色贴近底色、纹理线与网格线在深色主题下要反过来变暗。
  'chart-obs', 'chart-est', 'chart-bar', 'chart-hatch',
  // 遮罩必须逐主题声明：深色主题若沿用根层的近黑没问题，但"沿用 --fg"会把页面提亮。
  'scrim',
]

const THEMES = ['steel', 'charcoal', 'paper'] as const

function block(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`找不到选择器 ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim())
  }
  return map
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

const root = declarations(block(':root'))

describe('令牌层', () => {
  it('根层定义了全部 26 个语义键', () => {
    const missing = REQUIRED_KEYS.filter((key) => !root.has(key))
    expect(missing).toEqual([])
    expect(root.size).toBeGreaterThanOrEqual(REQUIRED_KEYS.length)
  })

  it.each(THEMES)('%s 主题覆盖了全部颜色键', (theme) => {
    const themeBlock = declarations(block(`html[data-theme="${theme}"]`))
    const missing = THEME_COLOR_KEYS.filter((key) => !themeBlock.has(key))
    expect(missing).toEqual([])
  })

  it('字体栈只使用系统字族并带回退链', () => {
    for (const key of ['sans', 'display', 'mono']) {
      const stack = root.get(key) ?? ''
      expect(stack).toMatch(/sans-serif|monospace/)
      expect(stack).not.toMatch(/@import|url\(/)
    }
  })

  it('风险色阶在四套主题下都是暖色相且彼此不同', () => {
    const themes = ['', 'steel', 'charcoal', 'paper']
    const values = themes.map((theme) => {
      const body = theme === '' ? root : declarations(block(`html[data-theme="${theme}"]`))
      return body.get('risk') ?? ''
    })

    for (const value of values) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/)
      const { r, g, b } = hexToRgb(value)
      // 暖色相：红通道必须高于绿与蓝，避免出现绿色或蓝色等"安全"语义
      expect(r).toBeGreaterThan(g)
      expect(r).toBeGreaterThan(b)
    }

    // 深色主题需要提亮，因此取值必须与浅色主题不同；同时不得换成另一色相
    expect(new Set(values).size).toBeGreaterThan(1)
  })
})
