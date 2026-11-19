/**
 * 图表色守卫：趋势图必须用 --chart-* 令牌，不能用文本色顶替。
 *
 * 背景：改色时曾把柱色写成 var(--fg-inv)（"反白"文本色），在浅色主题下柱与卡片同色，
 * 整张"提交数"图看着像空的；同时定义好的 --chart-bar/--chart-hatch 没人引用。
 * 渲染后是否可见由 e2e 与对比度测试覆盖，这里固定"文本层面"能证明的两件事：
 * ① 每个 --chart-* 令牌都被引用；② 柱与两条折线绑定到对应的图表令牌。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const SOURCE_FILES = [
  'src/styles/tokens.css',
  'src/features/research/TrendPage.tsx',
  'src/features/research/components/TrendPanels.tsx',
]

const CHART_TOKENS = ['chart-obs', 'chart-est', 'chart-bar', 'chart-hatch']

const panels = read('src/features/research/components/TrendPanels.tsx')
const trendPage = read('src/features/research/TrendPage.tsx')

describe('图表色', () => {
  it.each(CHART_TOKENS)('--%s 至少被一处引用', (token) => {
    const referenced = SOURCE_FILES.some((file) => read(file).includes(`var(--${token})`))
    expect(referenced).toBe(true)
  })

  it('提交数柱绑定 --chart-bar，而不是反白文本色', () => {
    expect(panels).toMatch(/className="trend-bar" fill="var\(--chart-bar\)"/)
    expect(panels).not.toMatch(/className="trend-bar"[^>]*var\(--fg-inv\)/)
  })

  it('观测线与估计线分别绑定 --chart-obs 与 --chart-est', () => {
    expect(panels).toMatch(/className="trend-line trend-line-observed"[^>]*stroke="var\(--chart-obs\)"/)
    expect(panels).toMatch(/className="trend-line trend-line-estimated"[^>]*stroke="var\(--chart-est\)"/)
    expect(panels).toMatch(/className="trend-dot trend-dot-observed" fill="var\(--chart-obs\)"/)
    expect(panels).toMatch(/className="trend-dot trend-dot-estimated" fill="var\(--chart-est\)"/)
  })

  it('图例色块与实际柱/线同色', () => {
    expect(trendPage).toMatch(/bg-\[var\(--chart-bar\)\]/)
    expect(trendPage).toMatch(/bg-\[var\(--chart-obs\)\]/)
    expect(trendPage).toMatch(/bg-\[var\(--chart-est\)\]/)
  })
})
