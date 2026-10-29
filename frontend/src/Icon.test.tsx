/**
 * 图标材料约定（design D5 / IP-09）：同一网格、同一描边、方头端点、矩形圆角 2。
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, Icon } from './Icon'

describe('图标材料', () => {
  it('图标集覆盖既有 12 个键与新增 8 个键', () => {
    const required = [
      'logo', 'list', 'project', 'search', 'arrow',
      'chevron', 'check', 'plus', 'close', 'info', 'trend',
      'sliders', 'copy', 'external', 'warning', 'collapse', 'filter', 'sort', 'download',
    ]
    expect(ICON_NAMES).toEqual(expect.arrayContaining(required))
    expect(ICON_NAMES).toHaveLength(required.length)
  })

  it.each(ICON_NAMES)('%s 使用 20 网格、1.5 描边与方头端点', (name) => {
    const { container } = render(<Icon name={name} />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg?.getAttribute('stroke-width')).toBe('1.5')
    expect(svg?.getAttribute('stroke-linecap')).toBe('square')
    expect(svg?.getAttribute('stroke-linejoin')).toBe('miter')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('矩形一律圆角 2，不出现其他圆角值', () => {
    for (const name of ICON_NAMES) {
      const { container } = render(<Icon name={name} />)
      const rects = [...container.querySelectorAll('rect')]
      for (const rect of rects) expect(rect.getAttribute('rx')).toBe('2')
      // 同时确认图标确实由路径或矩形构成，避免空图标混入
      expect(container.querySelectorAll('path, rect, circle').length).toBeGreaterThan(0)
    }
  })

  it('默认显示尺寸为 16px，可覆盖', () => {
    const { container } = render(<Icon name="list" />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
    const sized = render(<Icon name="list" size={24} />)
    expect(sized.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
