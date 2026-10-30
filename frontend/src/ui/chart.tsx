/**
 * 项目图表的共享封装：ECharts 模块按需注册、SVG 渲染、主题令牌与尺寸管理。
 * 页面只负责把数据编译成 option，并补充各自的键盘与下钻行为。
 */
import { useEffect, useRef, useState } from 'react'
import { LineChart, PieChart, type LineSeriesOption, type PieSeriesOption } from 'echarts/charts'
import { AxisPointerComponent, GridComponent, TooltipComponent, type AxisPointerComponentOption, type GridComponentOption, type TooltipComponentOption } from 'echarts/components'
import { init, use as registerCharts, type ComposeOption, type ECharts } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'

registerCharts([LineChart, PieChart, GridComponent, TooltipComponent, AxisPointerComponent, SVGRenderer])

export type ChartOption = ComposeOption<LineSeriesOption | PieSeriesOption | GridComponentOption | TooltipComponentOption | AxisPointerComponentOption>

export interface ChartColors {
  series: string
  seriesInk: string
  grid: string
  axis: string
  text: string
  textStrong: string
  surface: string
  border: string
  categorical: string[]
  other: string
}

// 分类色来自数据可视化规范的已验证顺序；浅色下部分色相低于 3:1，由可见图例与等价表格提供补偿。
const LIGHT_CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
const DARK_CATEGORICAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']
const LIGHT: ChartColors = { series: '#2a78d6', seriesInk: '#104281', grid: '#e3e7ee', axis: '#cdd4df', text: '#4a5464', textStrong: '#111827', surface: '#ffffff', border: '#cdd4df', categorical: LIGHT_CATEGORICAL, other: '#8a8a83' }
const DARK: ChartColors = { series: '#3987e5', seriesInk: '#93b4fa', grid: '#263149', axis: '#36425d', text: '#95a5bc', textStrong: '#e6edf7', surface: '#111827', border: '#36425d', categorical: DARK_CATEGORICAL, other: '#5a5a55' }

function readColors(): ChartColors {
  const fallback = document.documentElement.dataset.theme === 'charcoal' ? DARK : LIGHT
  const style = getComputedStyle(document.documentElement)
  const token = (name: string, value: string) => style.getPropertyValue(name).trim() || value
  return {
    series: token('--project-series', fallback.series),
    seriesInk: token('--project-series-ink', fallback.seriesInk),
    grid: token('--line', fallback.grid),
    axis: token('--line-strong', fallback.axis),
    text: token('--fg-3', fallback.text),
    textStrong: token('--fg', fallback.textStrong),
    surface: token('--card', fallback.surface),
    border: token('--line-strong', fallback.border),
    categorical: fallback.categorical,
    other: fallback.other,
  }
}

/** 跟随 html[data-theme] 重建图表配色；主题令牌是唯一来源。 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(readColors)
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return colors
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

export function EChartCanvas({ option, height = 240, label, onChart, className = 'ui-chart' }: {
  option: ChartOption
  height?: number
  label: string
  onChart?: (chart: ECharts) => void
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<ECharts | null>(null)
  const ready = useRef(onChart)
  useEffect(() => { ready.current = onChart }, [onChart])
  useEffect(() => {
    const element = host.current
    if (!element) return
    const width = Math.max(320, Math.round(element.getBoundingClientRect().width) || 640)
    const chart = init(element, undefined, { renderer: 'svg', width, height })
    instance.current = chart
    ready.current?.(chart)
    const resize = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      chart.resize({ width: next > 0 ? next : width, height })
    }
    window.addEventListener('resize', resize)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element)
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); chart.dispose(); instance.current = null }
  }, [height])
  useEffect(() => { instance.current?.setOption(option, { notMerge: true }) }, [option])
  return <div ref={host} className={className} style={{ height }} role="img" aria-label={label}/>
}

/** 提示框与坐标轴共用同一套主题；只接受已校验的数字与日期文本。 */
export function chartTooltip(colors: ChartColors): ChartOption['tooltip'] {
  return {
    trigger: 'axis',
    confine: true,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: colors.textStrong, fontSize: 12, lineHeight: 19 },
    extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);',
    axisPointer: { type: 'line', lineStyle: { color: colors.axis, width: 1 } },
  }
}
