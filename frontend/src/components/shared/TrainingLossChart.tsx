import { useMemo } from 'react'
import { EChartCanvas, useChartColors } from '@/components/shared/EChartCanvas'

export interface TrainingLossHistory {
  epochs: number
  entries: { epoch: number; trainLoss: number | null; trainEvalLoss?: number | null; validationLoss?: number | null }[]
}

/** 用户端与管理端共用的逐 epoch 训练损失曲线；无历史时不渲染。 */
export function TrainingLossChart({ history, method, height = 200, stopped = false }: {
  history: TrainingLossHistory | null
  method: string
  height?: number
  stopped?: boolean
}) {
  const colors = useChartColors()
  const last = history?.entries.at(-1)
  const best = useMemo(() => history?.entries.reduce<{ epoch: number; loss: number } | null>((current, entry) => {
    const loss = entry.validationLoss
    return typeof loss === 'number' && Number.isFinite(loss) && (!current || loss < current.loss || (loss === current.loss && entry.epoch < current.epoch))
      ? { epoch: entry.epoch, loss } : current
  }, null), [history])
  const option = useMemo(() => ({
    grid: { left: 52, right: 22, top: 12, bottom: 42 },
    tooltip: {
      trigger: 'axis' as const, confine: true, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.textStrong },
      valueFormatter: (value: unknown) => {
        const loss = Array.isArray(value) ? value[1] : value
        return typeof loss === 'number' && Number.isFinite(loss) ? loss.toFixed(4) : '未记录'
      },
    },
    xAxis: { type: 'value' as const, name: '训练轮次', nameLocation: 'middle' as const, nameGap: 28, nameTextStyle: { color: colors.text }, min: 1, max: Math.max(2, history?.epochs ?? 2), minInterval: 1, axisPointer: { label: { precision: 0 } }, axisLabel: { color: colors.text }, axisLine: { lineStyle: { color: colors.axis } }, splitLine: { show: false } },
    yAxis: { type: 'value' as const, scale: true, splitNumber: 4, axisLabel: { color: colors.text }, splitLine: { lineStyle: { color: colors.grid, type: 'dashed' as const } } },
    series: [{
      type: 'line' as const, name: '训练损失', symbol: 'circle', symbolSize: 5,
      data: history?.entries.map(item => [item.epoch, item.trainEvalLoss ?? item.trainLoss]),
      lineStyle: { color: colors.series, width: 2.5 },
      itemStyle: { color: colors.series }, areaStyle: { color: colors.series, opacity: 0.07 },
      markLine: stopped && last ? {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: colors.axis, type: 'dashed' as const },
        data: [{ xAxis: last.epoch }],
      } : undefined,
    }, ...(best ? [{
      type: 'line' as const, name: '验证损失', symbol: 'emptyCircle', symbolSize: 5,
      data: history?.entries.map(item => [item.epoch, item.validationLoss ?? null]),
      lineStyle: { color: colors.categorical[1], width: 2, type: 'dashed' as const },
      itemStyle: { color: colors.categorical[1] },
      markPoint: {
        silent: true, symbol: 'diamond', symbolSize: 12, label: { show: false },
        itemStyle: { color: colors.categorical[1], borderColor: colors.surface, borderWidth: 2 },
        data: [{ name: '最低验证损失', coord: [best.epoch, best.loss] }],
      },
    }] : [])],
  }), [best, colors, history, last, stopped])
  if (!history) return null
  return <div className="min-w-0">
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-1 text-xs text-foreground-3">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2" style={{ borderColor: colors.series }}/>训练集</span>
      {best ? <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed" style={{ borderColor: colors.categorical[1] }}/>验证集</span> : null}
    </div>
    <EChartCanvas option={option} height={height} label={`${method} 逐轮${best ? '训练和验证损失' : '训练损失'}`}/>
    {best || (stopped && last) ? <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border-soft px-4 py-2 text-xs">
      {best ? <div className="flex items-baseline gap-1.5"><dt className="text-foreground-3">最低验证损失</dt><dd className="font-semibold tabular-nums">第 {best.epoch} 轮 · {best.loss.toFixed(4)}</dd></div> : null}
      {stopped && last ? <div className="flex items-baseline gap-1.5"><dt className="text-foreground-3">最后记录</dt><dd className="font-semibold tabular-nums">第 {last.epoch} 轮</dd></div> : null}
    </dl> : null}
  </div>
}
