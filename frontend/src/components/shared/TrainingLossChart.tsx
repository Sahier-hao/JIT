import { useMemo } from 'react'
import { EChartCanvas, useChartColors } from '@/components/shared/EChartCanvas'

export interface TrainingLossHistory {
  epochs: number
  entries: { epoch: number; trainLoss: number | null; trainEvalLoss?: number | null; validationLoss?: number | null }[]
}

/** 用户端与管理端共用的逐 epoch 训练损失曲线；无历史时不渲染。 */
export function TrainingLossChart({ history, method, height = 200 }: {
  history: TrainingLossHistory | null
  method: string
  height?: number
}) {
  const colors = useChartColors()
  const hasValidation = history?.entries.some(item => item.validationLoss != null)
  const option = useMemo(() => ({
    grid: { left: 52, right: 22, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis' as const, confine: true, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.textStrong } },
    xAxis: { type: 'value' as const, min: 1, max: Math.max(2, history?.epochs ?? 2), minInterval: 1, axisLabel: { color: colors.text }, axisLine: { lineStyle: { color: colors.axis } }, splitLine: { show: false } },
    yAxis: { type: 'value' as const, scale: true, splitNumber: 4, axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid, type: 'dashed' as const } } },
    series: [{
      type: 'line' as const, name: '训练损失', symbol: 'circle', symbolSize: 5,
      data: history?.entries.map(item => [item.epoch, item.trainEvalLoss ?? item.trainLoss]),
      lineStyle: { color: colors.series, width: 2.5 },
      itemStyle: { color: colors.series }, areaStyle: { color: colors.series, opacity: 0.1 },
    }, ...(hasValidation ? [{
      type: 'line' as const, name: '验证损失', symbol: 'emptyCircle', symbolSize: 5,
      data: history?.entries.map(item => [item.epoch, item.validationLoss ?? null]),
      lineStyle: { color: colors.categorical[1], width: 2, type: 'dashed' as const },
      itemStyle: { color: colors.categorical[1] },
    }] : [])],
  }), [colors, hasValidation, history])
  if (!history) return null
  return <div className="min-w-0">
    {hasValidation ? <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-1 text-xs text-foreground-3">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2" style={{ borderColor: colors.series }}/>训练集</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed" style={{ borderColor: colors.categorical[1] }}/>验证集</span>
    </div> : null}
    <EChartCanvas option={option} height={height} label={`${method} 逐 epoch ${hasValidation ? '训练和验证损失' : '训练损失'}`}/>
  </div>
}
