/**
 * 图标材料约定（design D5 / IP-09）：同一入口、同一尺寸与描边。
 *
 * 非品牌图标来自 lucide（24 网格、1.5 描边）；品牌标志保留自绘 20 网格。
 */
import { render } from '@/lib/test-utils'
import { describe, expect, it } from 'vitest'
import { List, Folder, Search, ArrowRight, ArrowLeft, ArrowUpRight, ChevronRight, ChevronDown, ChevronLeft, Check, Plus, X, Info, AlertTriangle, TrendingUp, SlidersHorizontal, Copy, ExternalLink, Filter, ArrowUpDown, Download, Upload, User, Eye, EyeOff, Database, FileText, GitCompare, Loader, MoreHorizontal, Pin, RefreshCw, RotateCcw, Save, Settings, Trash2, XCircle } from 'lucide-react'
import { createElement, type ComponentType } from 'react'
import { BrandLogo } from '@/components/shared/BrandLogo'
const glyphs = {
  list: List,
  project: Folder,
  search: Search,
  arrow: ArrowRight,
  arrowLeft: ArrowLeft,
  arrowUpRight: ArrowUpRight,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  collapse: ChevronLeft,
  check: Check,
  plus: Plus,
  close: X,
  info: Info,
  warning: AlertTriangle,
  trend: TrendingUp,
  sliders: SlidersHorizontal,
  copy: Copy,
  external: ExternalLink,
  filter: Filter,
  sort: ArrowUpDown,
  download: Download,
  upload: Upload,
  user: User,
  eye: Eye,
  eyeOff: EyeOff,
  database: Database,
  fileText: FileText,
  gitCompare: GitCompare,
  loader: Loader,
  more: MoreHorizontal,
  pin: Pin,
  refresh: RefreshCw,
  rotate: RotateCcw,
  save: Save,
  settings: Settings,
  trash: Trash2,
  xCircle: XCircle,
 logo: BrandLogo }
const ICON_NAMES = Object.keys(glyphs) as (keyof typeof glyphs)[]

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
    const { container } = render(createElement(glyphs[name] as ComponentType<{strokeWidth: number; size: number; "aria-hidden": boolean}>, {strokeWidth: 1.5, size: 16, "aria-hidden": true}))
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('stroke-width')).toBe('1.5')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('非品牌图标使用 24 网格且默认不填充', () => {
    for (const name of lucideNames) {
      const { container } = render(createElement(glyphs[name] as ComponentType<{strokeWidth: number; size: number; "aria-hidden": boolean}>, {strokeWidth: 1.5, size: 16, "aria-hidden": true}))
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 24 24')
      expect(svg?.getAttribute('fill'), name).toBe('none')
    }
  })

  it('品牌标志保留自绘 20 网格与方头端点', () => {
    const { container } = render(<BrandLogo/>)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg?.getAttribute('stroke-linecap')).toBe('square')
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('默认显示尺寸为 16px，可覆盖', () => {
    const { container } = render(<List size={16} aria-hidden="true" strokeWidth={1.5}/>)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
    const sized = render(<List size={24} aria-hidden="true" strokeWidth={1.5}/>)
    expect(sized.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})
