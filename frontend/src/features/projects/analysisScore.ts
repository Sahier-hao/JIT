import type { ChartColors, ChartOption } from '@/components/shared/EChartCanvas'
import type { SyncCommit } from '@/features/projects/repositoryContract'
import type { RepositoryDistribution } from '@/features/projects/repositoryWorkspace'

/** 分数分布用 0.05 一档，正好把 0.10 与 0.25 两个阈值落在档位上。 */
export const SCORE_BIN = 0.05
export const SCORE_BINS = 20
export const HIGH_THRESHOLD = 0.25
export const MID_THRESHOLD = 0.10

export type ScoreBand = 'high' | 'medium' | 'low'

export function scoreBand(score: number): ScoreBand {
  if (score >= HIGH_THRESHOLD) return 'high'
  if (score >= MID_THRESHOLD) return 'medium'
  return 'low'
}

/** 与分档语义一致的高对比配色：高分档用警示色，中档琥珀，低档青绿。 */
export function bandColors(colors: ChartColors): Record<ScoreBand | 'unknown', string> {
  return {
    high: colors.categorical[3] ?? colors.series,
    medium: colors.categorical[1] ?? colors.series,
    low: colors.categorical[0] ?? colors.series,
    unknown: colors.other,
  }
}

export function scoreHistogram(commits: SyncCommit[]): number[] {
  const counts = Array.from({ length: SCORE_BINS }, () => 0)
  for (const commit of commits) {
    const index = Math.min(SCORE_BINS - 1, Math.max(0, Math.floor(commit.risk / SCORE_BIN)))
    counts[index] += 1
  }
  return counts
}

export function histogramOption(commits: SyncCommit[], colors: ChartColors): ChartOption {
  const counts = scoreHistogram(commits)
  const palette = bandColors(colors)
  const max = Math.max(...counts, 1)
  return {
    animationDuration: 300,
    grid: { left: 34, right: 12, top: 18, bottom: 26 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: colors.textStrong, fontSize: 12 },
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: unknown } | undefined
        const index = typeof first?.dataIndex === 'number' ? first.dataIndex : 0
        const from = (index * SCORE_BIN).toFixed(2)
        const to = ((index + 1) * SCORE_BIN).toFixed(2)
        return `${from} – ${to}：${counts[index]} 条`
      },
    },
    xAxis: {
      type: 'category',
      data: counts.map((_, index) => (index * SCORE_BIN).toFixed(2)),
      axisLine: { lineStyle: { color: colors.axis } },
      axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 10, interval: 3 },
    },
    yAxis: {
      type: 'value', min: 0, max: Math.ceil(max / 4) * 4, splitNumber: 2, minInterval: 1,
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.grid, width: 1 } },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      barWidth: '72%',
      data: counts.map((value, index) => ({
        value,
        itemStyle: { color: palette[scoreBand(index * SCORE_BIN)], borderRadius: [3, 3, 0, 0] },
      })),
    }],
  }
}

/** 提交过多时退回按分档统计：数量来自服务端汇总，不抽样。 */
export function bandsOption(distribution: RepositoryDistribution, colors: ChartColors): ChartOption {
  const palette = bandColors(colors)
  const rows = [
    { key: 'high' as const, label: `${HIGH_THRESHOLD} 及以上`, value: distribution.high },
    { key: 'medium' as const, label: '0.10 – 0.25', value: distribution.medium },
    { key: 'low' as const, label: '0.10 以下', value: distribution.low },
    ...(distribution.unknown ? [{ key: 'unknown' as const, label: '未评分', value: distribution.unknown }] : []),
  ]
  const max = Math.max(...rows.map(row => row.value), 1)
  return {
    animationDuration: 300,
    grid: { left: 34, right: 12, top: 22, bottom: 26 },
    tooltip: {
      trigger: 'axis', confine: true,
      backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
      textStyle: { color: colors.textStrong, fontSize: 12 },
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params[0] : params) as { dataIndex?: unknown } | undefined
        const row = rows[typeof first?.dataIndex === 'number' ? first.dataIndex : 0]
        return row ? `${row.label}：${row.value} 条` : ''
      },
    },
    xAxis: {
      type: 'category', data: rows.map(row => row.label),
      axisLine: { lineStyle: { color: colors.axis } }, axisTick: { show: false },
      axisLabel: { color: colors.text, fontSize: 11 },
    },
    yAxis: {
      type: 'value', min: 0, max: Math.ceil(max * 1.15), splitNumber: 2, minInterval: 1,
      axisLabel: { color: colors.text, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.grid, width: 1 } },
      axisLine: { show: false }, axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 72,
      data: rows.map(row => ({ value: row.value, itemStyle: { color: palette[row.key], borderRadius: [3, 3, 0, 0] } })),
      label: { show: true, position: 'top' as const, color: colors.textStrong, fontSize: 11 },
    }],
  }
}
