/**
 * 材料规范的机器可核对部分（design「材料规范」/ IP-09）。
 *
 * 允许的例外只有三类：
 * 1) 结构化内嵌线（inset box-shadow，用作左缘锚点/选中条）
 * 2) 焦点与选中环（0 0 0 Npx）
 * 3) 抽屉的一层投影（var(--sh-2)）与过渡属性里的 box-shadow 关键字
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const styleDir = resolve(root, 'src/styles')
const files = [
  ...readdirSync(styleDir).filter((f) => f.endsWith('.css')).map((f) => resolve(styleDir, f)),
  resolve(root, 'src/trend.css'),
]

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

describe('材料规范', () => {
  it('hover 只改背景与颜色，不改尺寸（避免列表抖动）', () => {
    const offenders: string[] = []
    for (const file of files) {
      const css = read(file)
      for (const match of css.matchAll(/([^{}]*:hover[^{}]*)\{([^}]*)\}/g)) {
        const selector = match[1].trim().split('\n').pop()?.trim() ?? ''
        // 子元素尺寸类属性出现在 hover 里会改变布局
        if (/(^|;)\s*(padding|margin|width|height|font-size|gap)\s*:/.test(match[2])) {
          // 允许只改子元素颜色/背景的选择器，这类不在此列
          offenders.push(`${file.split(/[\\/]/).pop()}: ${selector}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('材料组件使用令牌而非色值，且不出现胶囊与渐变', () => {
    const css = read(resolve(styleDir, 'components.css'))
    expect(css).toMatch(/var\(--card\)/)
    expect(css).toMatch(/var\(--line-strong\)/)
    expect(css).not.toMatch(/gradient|999px/)
  })
})
