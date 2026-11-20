import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EChartCanvas, chartTooltip, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import { Activity, Gauge, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Route } from '@/app/navigation'
import { userDatasets, type UserDataset } from '@/features/account/userClient'
import { formatDate } from '@/features/admin/adminContracts'
import {
  createPredictionBatch, predictionBatch, predictionBatches, predictionModels,
  type PredictionBatch, type PredictionBatchDetail, type PredictionModel,
} from '@/features/predictions/predictionClient'

type Metric = 'precision' | 'recall' | 'f1'

const LABEL_STATUS: Record<string, string> = {
  positive: '已确认正例',
  immature: '观察未满',
  unobserved: '观察未见修复',
  unknown: '标签状态未知',
}

function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

function scoreText(value: number): string {
  return value.toFixed(4)
}

function ratio(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function MyPredictionsPage({ batchId, initialDatasetVersion, navigate, onLoginRequired }: {
  batchId?: string
  initialDatasetVersion?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [batches, setBatches] = useState<PredictionBatch[] | null>(null)
  const [datasetVersion, setDatasetVersion] = useState(initialDatasetVersion ?? '')
  const [models, setModels] = useState<PredictionModel[] | null>(null)
  const [modelId, setModelId] = useState('')
  const [threshold, setThreshold] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    Promise.all([userDatasets('usable', controller.signal), predictionBatches(controller.signal)])
      .then(([datasetResult, batchResult]) => {
        if (controller.signal.aborted) return
        setDatasets(datasetResult.datasets)
        setBatches(batchResult)
        const preferred = datasetResult.datasets.find(item => item.version === datasetVersion)
          ?? datasetResult.datasets[0]
        setDatasetVersion(current => current || preferred?.version || '')
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '模型试算数据读取失败')
      })
    return () => controller.abort()
  }, [datasetVersion, onLoginRequired, revision])

  useEffect(() => {
    if (!datasetVersion) {
      setModels(null)
      setModelId('')
      return
    }
    const controller = new AbortController()
    setModels(null)
    setModelId('')
    predictionModels(datasetVersion, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setModels(result.models)
        setModelId(result.models[0]?.modelId ?? '')
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '兼容模型读取失败')
      })
    return () => controller.abort()
  }, [datasetVersion, onLoginRequired, revision])

  async function submit() {
    if (!datasetVersion || !modelId || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await createPredictionBatch({ datasetVersion, modelId, threshold })
      navigate({ name: 'my-predictions', batchId: created.batchId })
      setRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '模型试算失败')
    } finally {
      setBusy(false)
    }
  }

  const selectedDataset = datasets?.find(item => item.version === datasetVersion) ?? null
  return <section className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
    <aside className="min-w-0 rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">试算记录</h2>
          <p className="mt-0.5 text-[11px] text-foreground-4">固定数据与模型，可重复打开</p>
        </div>
        <Button size="icon" variant="ghost" type="button" onClick={() => setRevision(value => value + 1)} aria-label="刷新试算记录">
          <RefreshCw aria-hidden="true" size={15}/>
        </Button>
      </div>
      <div className="max-h-[68vh] overflow-y-auto p-2">
        {batches === null ? <LoadingNotice label="正在读取试算记录" prefix={false}/>
          : batches.length === 0 ? <p className="px-2 py-8 text-center text-xs text-foreground-3">还没有试算记录。</p>
          : <div className="grid gap-1">
            {batches.map(item => <button key={item.batchId} type="button"
              className={cn('rounded-lg border px-3 py-2.5 text-left transition-colors',
                item.batchId === batchId ? 'border-accent/35 bg-accent-soft' : 'border-transparent hover:bg-sunken')}
              onClick={() => navigate({ name: 'my-predictions', batchId: item.batchId })}>
              <span className="flex items-center justify-between gap-2">
                <strong className="truncate text-xs text-foreground">{item.dataset}</strong>
                <span className="shrink-0 text-[10px] tabular-nums text-foreground-4">{formatDate(item.createdAt)}</span>
              </span>
              <span className="mt-1 block truncate text-[11px] text-foreground-3">{item.model.name}</span>
              <span className="mt-1 flex items-center gap-2 text-[10px] text-foreground-4">
                <span>{countText(item.counts.records)} 条</span>
                <span>阈值 {item.threshold.toFixed(2)}</span>
              </span>
            </button>)}
          </div>}
      </div>
    </aside>

    <div className="grid min-w-0 content-start gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">模型试算</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-foreground-3">用已登记模型为选定数据版本批量打分，并按现有标签试算阈值、误报与漏报。</p>
        </div>
        <Button variant="outline" size="sm" type="button" onClick={() => navigate({ name: 'my-predictions' })}>新建试算</Button>
      </header>
      {error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
        <span>{error}</span><Button size="sm" variant="outline" type="button" onClick={() => setRevision(value => value + 1)}>重试</Button>
      </div> : null}
      {batchId ? <PredictionDetail batchId={batchId} onLoginRequired={onLoginRequired}/>
        : <PredictionSetup datasets={datasets} selectedDataset={selectedDataset} datasetVersion={datasetVersion}
          models={models} modelId={modelId} threshold={threshold} busy={busy}
          onDataset={setDatasetVersion} onModel={setModelId} onThreshold={setThreshold} onSubmit={() => void submit()}/>}
    </div>
  </section>
}

function PredictionSetup({ datasets, selectedDataset, datasetVersion, models, modelId, threshold, busy, onDataset, onModel, onThreshold, onSubmit }: {
  datasets: UserDataset[] | null
  selectedDataset: UserDataset | null
  datasetVersion: string
  models: PredictionModel[] | null
  modelId: string
  threshold: number
  busy: boolean
  onDataset: (value: string) => void
  onModel: (value: string) => void
  onThreshold: (value: number) => void
  onSubmit: () => void
}) {
  if (datasets === null) return <LoadingNotice label="正在读取可用数据"/>
  if (datasets.length === 0) return <EmptyState title="还没有可试算的数据" description="先到「我的数据」导入 CSV、Kamei ZIP 或从公开仓库构建数据集。"/>
  const model = models?.find(item => item.modelId === modelId) ?? null
  return <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-5 shadow-sm">
    <div className="flex items-center gap-2">
      <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Gauge aria-hidden="true" size={18}/></span>
      <div><h2 className="text-sm font-semibold">新建一次试算</h2><p className="mt-0.5 text-[11px] text-foreground-4">最多 {countText(20000)} 条提交</p></div>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">数据版本</span>
        <Select value={datasetVersion} onValueChange={onDataset}>
          <SelectTrigger aria-label="试算数据版本"><SelectValue placeholder="选择数据"/></SelectTrigger>
          <SelectContent>{datasets.map(item => <SelectItem key={item.version} value={item.version}>{item.dataset} · {item.mine ? '我的数据' : '共享数据'}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">固定模型</span>
        <Select value={modelId} onValueChange={onModel} disabled={!models?.length}>
          <SelectTrigger aria-label="试算模型"><SelectValue placeholder={models ? '没有兼容模型' : '正在读取模型'}/></SelectTrigger>
          <SelectContent>{(models ?? []).map(item => <SelectItem key={item.modelId} value={item.modelId}>{item.name}{item.isDefault ? ' · 默认' : ''}</SelectItem>)}</SelectContent>
        </Select>
      </label>
    </div>
    {selectedDataset ? <dl className="grid grid-cols-3 divide-x divide-border-soft rounded-lg bg-sunken p-3 text-center">
      <div><dt className="text-[10px] text-foreground-4">数据行数</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{countText(Number(selectedDataset.quality.includedRows))}</dd></div>
      <div><dt className="text-[10px] text-foreground-4">正例</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{countText(Number(selectedDataset.quality.positiveLabels))}</dd></div>
      <div><dt className="text-[10px] text-foreground-4">特征字段</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{countText(selectedDataset.fieldCount)}</dd></div>
    </dl> : null}
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="new-prediction-threshold" className="text-xs font-medium text-foreground-2">初始风险阈值</label>
        <strong className="text-sm tabular-nums text-foreground">{threshold.toFixed(2)}</strong>
      </div>
      <input id="new-prediction-threshold" type="range" min={0} max={100} step={1} value={Math.round(threshold * 100)}
        onChange={event => onThreshold(event.currentTarget.valueAsNumber / 100)} className="h-5 w-full cursor-pointer accent-accent"/>
    </div>
    {selectedDataset && models && models.length === 0 ? <div className="flex gap-2 rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="status">
      <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14}/>
      该数据版本没有 schema 兼容且已启用的模型。可先完成训练并登记，或选择其他数据版本。
    </div> : null}
    {model ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-soft px-3 py-2 text-xs text-foreground-3">
      <span>模型运行 <code className="font-mono text-[11px]">{model.runId?.slice(0, 12) ?? '未提供'}</code></span>
      <span>{model.method ?? '方法未提供'}</span>
    </div> : null}
    <div className="flex justify-end">
      <Button type="button" disabled={!datasetVersion || !modelId || busy} onClick={onSubmit}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : <Activity aria-hidden="true"/>}
        {busy ? '正在生成结果…' : '开始试算'}
      </Button>
    </div>
  </section>
}

function PredictionDetail({ batchId, onLoginRequired }: { batchId: string; onLoginRequired: () => void }) {
  const [detail, setDetail] = useState<PredictionBatchDetail | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError('')
    predictionBatch(batchId, { limit: 100, sort: 'risk' }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setDetail(value) })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '试算结果读取失败')
      })
    return () => controller.abort()
  }, [batchId, onLoginRequired, revision])
  if (error) return <div className="rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
    {error} <Button size="sm" variant="outline" type="button" onClick={() => setRevision(value => value + 1)}>重试读取</Button>
  </div>
  if (detail === null) return <LoadingNotice label="正在读取试算结果"/>
  return <PredictionResult detail={detail}/>
}

function PredictionResult({ detail }: { detail: PredictionBatchDetail }) {
  const [tick, setTick] = useState(Math.round(detail.threshold * 100))
  const [metric, setMetric] = useState<Metric>('precision')
  const preview = detail.thresholdPreview
  const hit = preview.truePositives[tick]
  const falseAlarm = preview.falsePositives[tick]
  const missed = preview.positives - hit
  const flagged = hit + falseAlarm
  const precision = hit + falseAlarm ? hit / (hit + falseAlarm) : 0
  const recall = preview.positives ? hit / preview.positives : 0
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0
  const metricValue = metric === 'precision' ? precision : metric === 'recall' ? recall : f1
  const labelTotal = Object.values(detail.labelStatusCounts).reduce((sum, value) => sum + value, 0)
  return <>
    <section className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="bg-[linear-gradient(135deg,var(--accent-soft),var(--card)_64%)] px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-[11px] text-foreground-3">
              <Activity aria-hidden="true" size={13}/>用户模型试算
            </span>
            <h2 className="mt-3 truncate text-2xl font-semibold tracking-tight">{detail.dataset}</h2>
            <code className="mt-1 block break-all font-mono text-[11px] text-foreground-4">{detail.datasetVersion}</code>
          </div>
          <div className="text-right text-xs text-foreground-3">
            <strong className="block text-sm text-foreground">{detail.model.name}</strong>
            <span>{detail.model.method ?? '方法未提供'}</span>
            <span className="mt-1 block">{formatDate(detail.createdAt)}</span>
          </div>
        </div>
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border-soft border-t border-border-soft sm:grid-cols-4 sm:divide-y-0">
        <MetricCell label="试算提交" value={countText(detail.counts.records)}/>
        <MetricCell label="现有正例" value={countText(detail.counts.positives)}/>
        <MetricCell label="当前告警" value={countText(flagged)}/>
        <MetricCell label="归因覆盖" value={`${detail.explanationCoverage.recorded}/${detail.explanationCoverage.limit}`}/>
      </dl>
    </section>

    <section className="grid gap-5 rounded-xl border border-border-soft bg-card p-5" aria-labelledby="prediction-threshold-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="prediction-threshold-title" className="text-sm font-semibold">阈值与指标</h2><p className="mt-0.5 text-[11px] text-foreground-4">分数达到阈值的提交计入告警</p></div>
        <div className="rounded-lg bg-sunken px-3 py-1.5 text-xs tabular-nums text-foreground-2">阈值 <strong className="text-foreground">{(tick / 100).toFixed(2)}</strong></div>
      </div>
      <input type="range" min={0} max={100} step={1} value={tick}
        aria-label="风险分数阈值" aria-valuetext={(tick / 100).toFixed(2)}
        onChange={event => setTick(event.currentTarget.valueAsNumber)}
        className="h-5 w-full cursor-pointer accent-accent"/>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCell label="告警" value={countText(flagged)}/>
        <MetricCell label="命中" value={countText(hit)}/>
        <MetricCell label="误报" value={countText(falseAlarm)}/>
        <MetricCell label="漏报" value={countText(missed)}/>
        <MetricCell label="精确率" value={ratio(precision)}/>
        <MetricCell label="召回率" value={ratio(recall)}/>
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
        <ThresholdCurve detail={detail} metric={metric}/>
        <div className="grid gap-2">
          <span className="text-xs font-medium text-foreground-2">选择指标</span>
          {([['precision', '精确率'], ['recall', '召回率'], ['f1', 'F1']] as const).map(([id, label]) =>
            <button key={id} type="button" onClick={() => setMetric(id)}
              className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-xs',
                metric === id ? 'border-accent/35 bg-accent-soft text-foreground' : 'border-border-soft hover:bg-sunken')}>
              <span>{label}</span><strong className="tabular-nums">{id === 'precision' ? ratio(precision) : id === 'recall' ? ratio(recall) : ratio(f1)}</strong>
            </button>)}
          <p className="text-[11px] leading-5 text-foreground-4">当前阈值指标：{metricValue.toFixed(4)}。以现有标签计算，仅用于选择工作点。</p>
        </div>
      </div>
      {labelTotal ? <div className="flex flex-wrap gap-1.5">
        {Object.entries(detail.labelStatusCounts).map(([status, count]) =>
          <span key={status} className="rounded-md bg-sunken px-2 py-1 text-[11px] text-foreground-3">{LABEL_STATUS[status] ?? status} {countText(count)}</span>)}
      </div> : null}
    </section>

    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-sm font-semibold">高风险提交</h2><p className="mt-0.5 text-[11px] text-foreground-4">显示风险最高的 {detail.records.length} 条，共 {countText(detail.counts.records)} 条</p></div>
        <span className="text-[11px] text-foreground-4">风险是模型估计，不是确认缺陷</span>
      </div>
      <div className="grid gap-2">
        {detail.records.map(record => <article key={record.predictionId} className="grid gap-3 rounded-xl border border-border-soft bg-card p-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <code className="text-xs font-semibold text-foreground">{record.recordId.slice(0, 12)}</code>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground-4">
                <span>{record.authorTime ? formatDate(record.authorTime) : '时间未提供'}</span>
                <span>{LABEL_STATUS[record.labelStatus] ?? record.labelStatus}</span>
                <span>现有标签 {record.label}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="block text-[10px] uppercase tracking-[.12em] text-foreground-4">风险分</span>
              <strong className={cn('mt-0.5 block text-lg tabular-nums', record.risk >= tick / 100 ? 'text-rose' : 'text-foreground')}>{scoreText(record.risk)}</strong>
            </div>
          </div>
          {record.explanation ? <div className="grid gap-2 rounded-lg bg-sunken p-3">
            <p className="text-xs leading-5 text-foreground-2">{record.explanation.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {record.explanation.items.map(item => <span key={item.feature} className="rounded-md bg-card px-2 py-1 font-mono text-[10px] text-foreground-3">
                {item.feature} <strong className={item.direction === 'increases' ? 'text-rose' : 'text-teal-deep'}>{item.delta > 0 ? '+' : ''}{item.delta.toFixed(3)}</strong>
              </span>)}
            </div>
          </div> : <p className="text-[11px] text-foreground-4">该记录没有保存归因，模型分数仍然有效。</p>}
        </article>)}
      </div>
    </section>

    <section className="rounded-xl border border-amber/20 bg-amber-soft p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-deep"><ShieldAlert aria-hidden="true" size={15}/>结果边界</div>
      <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-amber-deep/90">
        {detail.limitations.map(item => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-amber"/><span>{item}</span></li>)}
      </ul>
    </section>
  </>
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return <div className="px-4 py-3"><dt className="text-[10px] text-foreground-4">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{value}</dd></div>
}

function ThresholdCurve({ detail, metric }: { detail: PredictionBatchDetail; metric: Metric }) {
  const colors = useChartColors()
  const preview = detail.thresholdPreview
  const series = useMemo(() => preview.thresholds.map((_, index) => {
    const hit = preview.truePositives[index]
    const falseAlarm = preview.falsePositives[index]
    const precision = hit + falseAlarm ? hit / (hit + falseAlarm) : 0
    const recall = preview.positives ? hit / preview.positives : 0
    return metric === 'precision' ? precision : metric === 'recall' ? recall
      : precision + recall ? 2 * precision * recall / (precision + recall) : 0
  }), [metric, preview])
  const option: ChartOption = {
    animation: false,
    color: [colors.series],
    grid: { left: 42, right: 16, top: 18, bottom: 32 },
    tooltip: { ...chartTooltip(colors), trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: preview.thresholds.map(value => value.toFixed(2)),
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
      type: 'line', name: metric === 'precision' ? '精确率' : metric === 'recall' ? '召回率' : 'F1',
      data: series, showSymbol: false, smooth: false, lineStyle: { width: 2 },
    }],
  }
  return <EChartCanvas option={option} height={260} label="随风险阈值变化的指标曲线"/>
}
