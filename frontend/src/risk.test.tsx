/**
 * 风险编码（design D11 / IP-06 / CRR-03）：
 * 等宽百分比 + 4px 条 + 60% 刻度 + 分档色，低风险不使用绿色。
 */
import { render } from './test-utils'
import { describe, expect, it } from 'vitest'
import { Risk } from './Risk'

function tierOf(risk: unknown): string | null {
  const { container } = render(<Risk risk={risk} />)
  return container.querySelector('.risk-display')?.getAttribute('data-tier') ?? null
}

describe('风险编码', () => {
  it('按 60% 分档', () => {
    expect(tierOf(0.599)).toBe('low')
    expect(tierOf(0.6)).toBe('high')
    expect(tierOf(0.95)).toBe('high')
  })

  it('有效风险渲染条与 60% 刻度，缺失值不渲染条', () => {
    const valid = render(<Risk risk={0.65} />)
    expect(valid.container.querySelector('.risk-fill')).toHaveStyle({ width: '65%' })
    expect(valid.container.querySelector('.risk-tick')).not.toBeNull()

    const missing = render(<Risk risk={null} />)
    expect(missing.container.querySelector('.risk-track')).toBeNull()
    expect(missing.container.querySelector('.risk-display')?.getAttribute('data-tier')).toBe('none')
  })

  it('模型分数保留两位小数（CRR-03）', () => {
    const text = (risk: unknown) => render(<Risk risk={risk} />).container.querySelector('.risk-number, .risk-unavailable')?.textContent
    expect(text(1)).toBe('1.00')
    expect(text(0)).toBe('0.00')
    expect(text(0.618)).toBe('0.62')
    expect(text(undefined)).toBe('暂无预测')
    expect(text(1.4)).toBe('风险数据无效')
  })
})
