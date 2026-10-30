/**
 * 图表色守卫：趋势图必须用 --chart-* 令牌，不能用文本色顶替。
 *
 * 背景：改色时曾把柱色写成 var(--fg-inv)（"反白"文本色），在浅色主题下柱与卡片同色，
 * 整张"提交数"图看着像空的；同时定义好的 --chart-bar/--chart-hatch 没人引用。
 * 渲染后是否可见由 e2e 与对比度测试覆盖，这里固定"文本层面"能证明的两件事：
 * ① 每个 --chart-* 令牌都被样式引用；② 柱与两条折线绑定到对应的图表令牌。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const SOURCE_FILES = [
  'src/styles/tokens.css',
  'src/styles/base.css',
  'src/styles/product.css',
  'src/styles/components.css',
  'src/trend.css',
  // SVG 的纹理线写在 JSX 属性里（pattern 的 stroke），不是 CSS 规则。
  'src/TrendPage.tsx',
  'src/components/report/TrendPanels.tsx',
]

const CHART_TOKENS = ['chart-obs', 'chart-est', 'chart-bar', 'chart-hatch']

/** 图表规则所在的样式（趋势图已统一在 trend.css）。 */
const chartCss = ['src/trend.css'].map(read).join('\n')

describe('图表色', () => {
  it.each(CHART_TOKENS)('--%s 至少被一处样式引用', (token) => {
    const referenced = SOURCE_FILES.some((file) => read(file).includes(`var(--${token})`))
    expect(referenced).toBe(true)
  })

  it('提交数柱绑定 --chart-bar，而不是反白文本色', () => {
    expect(chartCss).toMatch(/\.trend-bar\s*\{[^}]*fill:\s*var\(--chart-bar\)/)
    expect(chartCss).not.toMatch(/\.trend-bar\s*\{[^}]*var\(--fg-inv\)/)
  })

  it('观测线与估计线分别绑定 --chart-obs 与 --chart-est', () => {
    expect(chartCss).toMatch(/\.trend-line-observed\s*\{[^}]*stroke:\s*var\(--chart-obs\)/)
    expect(chartCss).toMatch(/\.trend-line-estimated\s*\{[^}]*stroke:\s*var\(--chart-est\)/)
    expect(chartCss).toMatch(/\.trend-dot-observed\s*\{[^}]*fill:\s*var\(--chart-obs\)/)
    expect(chartCss).toMatch(/\.trend-dot-estimated\s*\{[^}]*fill:\s*var\(--chart-est\)/)
  })

  it('图例色块与实际柱/线同色', () => {
    expect(chartCss).toMatch(/\.trend-swatch-bar\s*\{[^}]*background:\s*var\(--chart-bar\)/)
    expect(chartCss).toMatch(/\.trend-swatch-observed\s*\{[^}]*background:\s*var\(--chart-obs\)/)
  })
})
