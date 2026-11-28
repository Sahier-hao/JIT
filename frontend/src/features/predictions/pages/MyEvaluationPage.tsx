import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { EChartCanvas, chartTooltip, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Route } from '@/app/navigation'
import {
  predictionEvaluation, type PredictionEvaluation, type PredictionPartition,
} from '@/features/predictions/predictionClient'
import { metricCurve, thresholdMetrics } from '@/features/predictions/thresholdMetrics'

type Metric = 'precision' | 'recall' | 'f1'

const METRIC_LABEL: Record<Metric, string> = {
  precision: '精确率',
  recall: '召回率',
  f1: 'F1',
}
const PARTITION_LABEL: Record<PredictionPartition, string> = {
  train: '训练集', validation: '验证集', test: '测试集',
}

function countText(value: number): string {
  return value.toLocaleString('zh-CN')
}

function ratioText(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function MyEvaluationPage({ route, navigate, onLoginRequired }: {
  route: Extract<Route, { name: 'my-evaluation' }>
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [detail, setDetail] = useState<PredictionEvaluation | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [tick, setTick] = useState(50)
  const [tickBatchId, setTickBatchId] = useState('')
  const [metric, setMetric] = useState<Metric>('precision')

  useEffect(() => {
    if (!route.batchId) return
    const controller = new AbortController()
    setDetail(null); setError('')
    predictionEvaluation(route.batchId, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (route.modelId && route.modelId !== value.model.modelId) {
        throw new Error('评估地址中的模型与预测批次不一致')
      }
      if (route.datasetVersion && route.datasetVersion !== value.datasetVersion) {
        throw new Error('评估地址中的数据版本与预测批次不一致')
      }
      if (route.partition && route.partition !== value.partition) {
        throw new Error('评估地址中的分区与预测批次不一致')
      }
      if (route.splitPreset && route.splitPreset !== value.splitPreset) {
        throw new Error('评估地址中的切分预设与预测批次不一致')
      }
      setDetail(value)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '评估读取失败')
    })
    return () => controller.abort()
  }, [attempt, onLoginRequired, route.batchId, route.datasetVersion, route.modelId, route.partition, route.splitPreset])

  useEffect(() => {
    if (detail && detail.batchId !== tickBatchId) {
      setTick(Math.round(detail.threshold * 100))
      setTickBatchId(detail.batchId)
    }
  }, [detail, tickBatchId])

  if (!route.batchId) {
    return <EmptyState title="没有可评估的预测批次" description="请从包含可用真实标签的缺陷预测结果进入评估。">
      <Button variant="default" onClick={() => navigate({ name: 'my-predictions' })}>返回缺陷预测</Button>
    </EmptyState>
  }
  if (error) return <div className="grid gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
    <span>{error}</span>
    <div className="flex gap-2">
      <Button size="sm" variant="outline" type="button" onClick={() => setAttempt(value => value + 1)}>重试读取</Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => navigate({ name: 'my-predictions', batchId: route.batchId })}>返回结果</Button>
    </div>
  </div>
  if (detail === null) return <LoadingNotice label="正在读取评估批次"/>

  const metrics = thresholdMetrics(detail.thresholdPreview, tick)
  return <section className="grid gap-4">
    <WorkspacePageHeader
      title="预测评估"
      meta="使用批次中已成熟且可用的真实标签重算阈值与分类指标。"
      actions={<Button variant="outline" size="sm" type="button"
        onClick={() => navigate({ name: 'my-predictions', batchId: detail.batchId })}>
        <ArrowLeft aria-hidden="true"/>返回结果
      </Button>}
    />

    <section className="rounded-xl border border-border-soft bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{detail.dataset ?? '预测批次'}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-3">
            <span>批次 <code className="font-mono">{detail.batchId}</code></span>
            {detail.datasetVersion ? <span>数据版本 <code className="font-mono">{detail.datasetVersion}</code></span> : null}
            {detail.partition ? <span>分区 {PARTITION_LABEL[detail.partition]}</span> : null}
            {detail.splitPreset ? <span>预设 {detail.splitPreset}</span> : null}
          </div>
        </div>
        <div className="text-right text-xs text-foreground-3">
          <strong className="block text-sm text-foreground">{detail.model.name}</strong>
          <span>{detail.model.method ?? '方法未提供'} · {detail.model.featureSchemaVersion}</span>
          <span className="mt-1 block">运行 <code className="font-mono">{detail.model.runId?.slice(0, 12) ?? '未提供'}</code></span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-foreground-3">
        <span className="rounded-md bg-sunken px-2 py-1">可用标签 {countText(detail.counts.labeledAvailable)}</span>
        <span className="rounded-md bg-sunken px-2 py-1">无标签 {countText(detail.counts.unavailable)}</span>
        <span className="rounded-md bg-sunken px-2 py-1">正例 {countText(detail.counts.positives)}</span>
        <span className="rounded-md bg-sunken px-2 py-1">负例 {countText(detail.counts.negatives)}</span>
      </div>
    </section>

    {!detail.eligible ? <EmptyState title="该批次不能进入分类评估" description={detail.reason}>
      <Button variant="default" onClick={() => navigate({ name: 'my-predictions', batchId: detail.batchId })}>返回结果查看或导出</Button>
    </EmptyState> : <>
      <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">阈值工作点</h2>
            <p className="mt-0.5 text-[11px] text-foreground-4">只重算已保存分数，不重新推理。</p>
          </div>
          <output className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-semibold tabular-nums">阈值 {(tick / 100).toFixed(2)}</output>
        </div>
        <Slider label="评估阈值" value={[tick]} onValueChange={values => setTick(values[0])}/>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 [&>div]:rounded-lg [&>div]:bg-sunken">
          <MetricCell label="告警" value={countText(metrics.flagged)}/>
          <MetricCell label="命中" value={countText(metrics.confusion.tp)}/>
          <MetricCell label="误报" value={countText(metrics.confusion.fp)}/>
          <MetricCell label="漏报" value={countText(metrics.miss)}/>
          <MetricCell label="精确率" value={ratioText(metrics.precision)}/>
          <MetricCell label="召回率" value={ratioText(metrics.recall)}/>
        </dl>
      </section>

      <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">精确率 / 召回率 / F1</h2>
            <p className="mt-0.5 text-[11px] text-foreground-4">当前指标：{METRIC_LABEL[metric]}</p>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="评估指标">
            {(['precision', 'recall', 'f1'] as const).map(item => <Button key={item} size="sm" type="button"
              variant={metric === item ? 'default' : 'outline'} onClick={() => setMetric(item)}>{METRIC_LABEL[item]}</Button>)}
          </div>
        </div>
        <EvaluationCurve detail={detail} metric={metric} tick={tick}/>
      </section>

      <section className="grid gap-3 rounded-xl border border-border-soft bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold">混淆矩阵</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-label="混淆矩阵">
            <thead><tr><th className="p-2 text-left font-medium text-foreground-3">实际 / 预测</th><th className="p-2 text-right font-medium text-foreground-3">达到阈值</th><th className="p-2 text-right font-medium text-foreground-3">未达到阈值</th></tr></thead>
            <tbody>
              <tr className="border-t border-border-soft"><th className="p-2 text-left font-medium">正例</th><td className="p-2 text-right tabular-nums">{countText(metrics.confusion.tp)}</td><td className="p-2 text-right tabular-nums">{countText(metrics.confusion.fn)}</td></tr>
              <tr className="border-t border-border-soft"><th className="p-2 text-left font-medium">负例</th><td className="p-2 text-right tabular-nums">{countText(metrics.confusion.fp)}</td><td className="p-2 text-right tabular-nums">{countText(metrics.confusion.tn)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-foreground-4">只统计本批次中标签状态为已确认正例或观察期已满且未见修复的记录。</p>
      </section>
    </>}

    <section className="rounded-xl border border-amber/20 bg-amber-soft p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-deep"><ShieldAlert aria-hidden="true" size={15}/>评估边界</div>
      <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-amber-deep/90">
        {detail.limitations.map(item => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-amber"/><span>{item}</span></li>)}
      </ul>
    </section>
  </section>
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <div className="px-3 py-2.5"><dt className="text-[10px] text-foreground-4">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</dd></div>
}

function EvaluationCurve({ detail, metric, tick }: {
  detail: PredictionEvaluation
  metric: Metric
  tick: number
}) {
  const colors = useChartColors()
  const values = useMemo(() => metricCurve(detail.thresholdPreview, metric), [detail.thresholdPreview, metric])
  const option: ChartOption = {
    animation: false,
    color: [colors.series],
    grid: { left: 42, right: 16, top: 18, bottom: 32 },
    tooltip: { ...chartTooltip(colors), trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: detail.thresholdPreview.thresholds.map(value => value.toFixed(2)),
      boundaryGap: false,
      axisLabel: { color: colors.text, interval: 19 },
      axisLine: { lineStyle: { color: colors.axis } },
    },
    yAxis: {
      type: 'value', min: 0, max: 1,
      axisLabel: { color: colors.text, formatter: (value: number) => value.toFixed(1) },
      splitLine: { lineStyle: { color: colors.grid } },
    },
    series: [{
      type: 'line',
      name: METRIC_LABEL[metric],
      data: values,
      showSymbol: false,
      smooth: false,
      lineStyle: { width: 2 },
      markLine: {
        silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: colors.axis },
        data: [{ xAxis: detail.thresholdPreview.thresholds[tick].toFixed(2) }],
      },
      markPoint: {
        silent: true, symbol: 'circle', symbolSize: 9, label: { show: false },
        data: [{ name: '当前阈值', coord: [detail.thresholdPreview.thresholds[tick].toFixed(2), values[tick]] }],
      },
    }],
  }
  return <div className={cn('min-w-0')}><EChartCanvas option={option} height={280} label={`随阈值变化的${METRIC_LABEL[metric]}曲线`}/></div>
}
