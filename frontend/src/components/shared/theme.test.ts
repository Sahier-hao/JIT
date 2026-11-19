/**
 * 主题桥接完整性：tokens.css 里的每个令牌都必须能从 Tailwind 工具类读到。
 *
 * 做法：从 tokens.css 解析全部 `--name:` 声明，再断言 index.css 的 `@theme inline`
 * 里出现 `var(--name)`。这样令牌新增后若忘记映射，工具类会悄悄回退到无色值，
 * 本测试会在本地与 CI 直接失败。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

/** tokens.css 中声明的全部令牌名（含主题块与密度块）。 */
function declaredTokens(css: string): string[] {
  const names = new Set<string>()
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1])
  return [...names].sort()
}

/** index.css 的 @theme 区块文本。 */
function themeBlock(css: string): string {
  const start = css.indexOf('@theme')
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('index.css 缺少完整的 @theme 区块')
}

describe('主题桥接', () => {
  it('每个设计令牌都被 @theme 映射', () => {
    const theme = themeBlock(index)
    const missing = declaredTokens(tokens).filter((name) => !theme.includes(`var(${name})`))
    expect(missing, `未映射到 @theme 的令牌：${missing.join(', ')}`).toEqual([])
  })

  it('圆角档位与令牌名实一致', () => {
    const theme = themeBlock(index)
    expect(theme).toMatch(/--radius-sm:\s*var\(--r\);/)
    expect(theme).toMatch(/--radius-md:\s*var\(--r-xs\);/)
    expect(theme).toMatch(/--radius-lg:\s*var\(--r-lg\);/)
    expect(theme).toMatch(/--radius-xl:\s*var\(--r-md\);/)
    expect(theme).toMatch(/--radius-2xl:\s*var\(--r-xl\);/)
  })

  it('密度间距从令牌读取，不在入口写死像素', () => {
    const theme = themeBlock(index)
    for (const key of ['row', 'cell-x', 'cell-y', 'card', 'section', 'page-x']) {
      expect(theme).toContain(`var(--sp-${key})`)
    }
  })

  it('紧凑密度只收紧间距，数值小于舒适档', () => {
    const rootStart = tokens.indexOf(':root {')
    const root = tokens.slice(rootStart, tokens.indexOf('}', rootStart))
    const compactStart = tokens.indexOf('html[data-density="compact"]')
    const compact = tokens.slice(compactStart, tokens.indexOf('}', compactStart))
    const read = (block: string, key: string) => {
      const match = block.match(new RegExp(`--${key}:\\s*(\\d+)px`))
      if (!match) throw new Error(`缺少 ${key}`)
      return Number(match[1])
    }
    for (const key of ['sp-row', 'sp-cell-y', 'sp-card', 'sp-section']) {
      expect(read(compact, key), `${key} 紧凑档应小于舒适档`).toBeLessThan(read(root, key))
    }
  })
})
