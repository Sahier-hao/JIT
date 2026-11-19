import { useMemo } from 'react'
import { EChartCanvas, useChartColors } from '@/components/shared/EChartCanvas'

export interface TrainingLossHistory {
  epochs: number
  entries: { epoch: number; trainLoss: number | null }[]
}

/** 用户端与管理端共用的逐 epoch 训练损失曲线；无历史时不渲染。 */
export function TrainingLossChart({ history, method }: { history: TrainingLossHistory | null; method: string }) {
  const colors = useChartColors()
  const option = useMemo(() => ({
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.textStrong } },
    xAxis: { type: 'category' as const, data: history?.entries.map(item => String(item.epoch)) ?? [], axisLabel: { color: colors.text }, axisLine: { lineStyle: { color: colors.axis } }, name: 'epoch', nameTextStyle: { color: colors.text } },
    yAxis: { type: 'value' as const, scale: true, axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid } }, name: 'train loss', nameTextStyle: { color: colors.text } },
    series: [{ type: 'line' as const, smooth: false, showSymbol: true, symbolSize: 4, data: history?.entries.map(item => item.trainLoss), lineStyle: { color: colors.series }, itemStyle: { color: colors.series } }],
  }), [colors, history])
  if (!history) return null
  return <EChartCanvas option={option} height={200} label={`${method} 逐 epoch 训练损失`}/>
}
