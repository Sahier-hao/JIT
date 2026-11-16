/**
 * 图标材料约定（design D5 / IP-09）：同一入口、同一尺寸与描边。
 *
 * 非品牌图标来自 lucide（24 网格、1.5 描边）；品牌标志保留自绘 20 网格。
 */
import { render } from './test-utils'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, Icon } from './Icon'

const lucideNames = ICON_NAMES.filter((name) => name !== 'logo')

describe('图标材料', () => {
  it('图标集覆盖共享语义键', () => {
    const required = [
      'logo', 'list', 'project', 'search', 'arrow', 'arrowLeft', 'arrowUpRight',
      'chevron', 'chevronDown', 'collapse', 'check', 'plus', 'close', 'info', 'warning',
      'trend', 'sliders', 'copy', 'external', 'filter', 'sort', 'download', 'upload',
      'user', 'eye', 'eyeOff', 'database', 'fileText', 'gitCompare', 'loader', 'more',
      'pin', 'refresh', 'rotate', 'save', 'settings', 'trash', 'xCircle',
    ]
    expect(ICON_NAMES).toEqual(expect.arrayContaining(required))
    expect(ICON_NAMES).toHaveLength(required.length)
  })

  it.each(ICON_NAMES)('%s 使用 1.5 描边并对辅助技术隐藏', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('stroke-width')).toBe('1.5')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('非品牌图标使用 24 网格', () => {
    for (const name of lucideNames) {
      const { container } = render(<Icon name={name} />)
      expect(container.querySelector('svg')?.getAttribute('viewBox'), name).toBe('0 0 24 24')
    }
  })

  it('品牌标志保留自绘 20 网格与方头端点', () => {
    const { container } = render(<Icon name="logo" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg?.getAttribute('stroke-linecap')).toBe('square')
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('默认显示尺寸为 16px，可覆盖', () => {
    const { container } = render(<Icon name="list" />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
    const sized = render(<Icon name="list" size={24} />)
    expect(sized.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
