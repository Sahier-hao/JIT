import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EChartCanvas, chartTooltip, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import { datasetVersionLabel } from '@/lib/datasetLabel'
import { Activity, Gauge, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Route } from '@/app/navigation'
import { userDatasets, userExperiments, userModels, type UserDataset, type UserModel } from '@/features/account/userClient'
import { formatDate, type TrainingExperiment } from '@/features/admin/adminContracts'
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
  const [registeredModels, setRegisteredModels] = useState<UserModel[] | null>(null)
  const [experiments, setExperiments] = useState<TrainingExperiment[] | null>(null)
  const [modelId, setModelId] = useState('')
  const [threshold, setThreshold] = useState(0.5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setHistoryError('')
    predictionBatches(controller.signal).then(result => {
      if (!controller.signal.aborted) setBatches(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setHistoryError(failure instanceof Error ? failure.message : '试算记录读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired, revision])

  useEffect(() => {
    if (batchId) return
    const controller = new AbortController()
    setError('')
    userDatasets('usable', controller.signal).then(({ datasets: items }) => {
      if (controller.signal.aborted) return
      setDatasets(items)
      setDatasetVersion(current => current || items[0]?.version || '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '模型试算数据读取失败')
    })
    return () => controller.abort()
  }, [batchId, onLoginRequired, revision])

  useEffect(() => {
    if (batchId || !datasetVersion) {
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
  }, [batchId, datasetVersion, onLoginRequired, revision])

  useEffect(() => {
    if (batchId || !models || models.length > 0) {
      setRegisteredModels(null)
      setExperiments(null)
      return
    }
    const controller = new AbortController()
    Promise.allSettled([userModels(controller.signal), userExperiments(controller.signal)])
      .then(([modelResult, experimentResult]) => {
        if (controller.signal.aborted) return
        setRegisteredModels(modelResult.status === 'fulfilled' ? modelResult.value : [])
        setExperiments(experimentResult.status === 'fulfilled' ? experimentResult.value : [])
      })
    return () => controller.abort()
  }, [batchId, models])

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
  const registeredSchemas = registeredModels === null ? null
    : [...new Set(registeredModels.filter(model => model.enabled && model.state === 'ready')
        .map(model => model.featureSchemaVersion))]
  const pendingExperiment = experiments?.find(experiment => experiment.tasks.some(task =>
    task.status === 'succeeded' && !task.modelId && task.featureSchemaVersion === selectedDataset?.schema)) ?? null
  const pendingCount = pendingExperiment?.tasks.filter(task =>
    task.status === 'succeeded' && !task.modelId && task.featureSchemaVersion === selectedDataset?.schema).length ?? 0
  return <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div className="grid min-w-0 content-start gap-4">
      <WorkspacePageHeader title="模型试算" meta="使用已登记模型为数据集打分，并试算分类阈值。"
        actions={<Button variant="outline" size="sm" type="button" onClick={() => navigate({ name: 'my-predictions' })}>新建试算</Button>}/>
      {error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
        <span>{error}</span><Button size="sm" variant="outline" type="button" onClick={() => setRevision(value => value + 1)}>重试</Button>
      </div> : null}
      {batchId ? <PredictionDetail batchId={batchId} onLoginRequired={onLoginRequired}/>
        : <PredictionSetup datasets={datasets} selectedDataset={selectedDataset} datasetVersion={datasetVersion}
          models={models} modelId={modelId} threshold={threshold} busy={busy}
          registeredSchemas={registeredSchemas} pendingCount={pendingCount}
          onRegister={pendingExperiment ? () => navigate({ name: 'my-training', experimentId: pendingExperiment.experimentId }) : null}
          onTrain={() => navigate({ name: 'my-training', datasetVersion })}
          onDataset={setDatasetVersion} onModel={setModelId} onThreshold={setThreshold} onSubmit={() => void submit()}/>}
    </div>
    <aside className="min-w-0 rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">试算记录</h2>
        </div>
        <Button size="icon" variant="ghost" type="button" onClick={() => setRevision(value => value + 1)} aria-label="刷新试算记录">
          <RefreshCw aria-hidden="true" size={15}/>
        </Button>
      </div>
      <div className="max-h-[68vh] overflow-y-auto p-2">
        {historyError ? <p className="px-2 py-2 text-xs text-rose-deep" role="alert">{historyError}</p> : null}
        {batches === null ? historyError ? null : <LoadingNotice label="正在读取试算记录" prefix={false}/>
          : batches.length === 0 ? <p className="px-2 py-8 text-center text-xs text-foreground-3">还没有试算记录。</p>
          : <div className="grid gap-1">
            {batches.map(item => <Button key={item.batchId} variant="ghost" type="button" aria-current={item.batchId === batchId ? 'page' : undefined}
              className={cn('flex h-auto w-full min-w-0 flex-col items-stretch gap-0 rounded-lg border px-3 py-2.5 text-left transition-colors',
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
            </Button>)}
          </div>}
      </div>
    </aside>
  </section>
}

function PredictionSetup({ datasets, selectedDataset, datasetVersion, models, modelId, threshold, busy, registeredSchemas, pendingCount, onRegister, onTrain, onDataset, onModel, onThreshold, onSubmit }: {
  datasets: UserDataset[] | null
  selectedDataset: UserDataset | null
  datasetVersion: string
  models: PredictionModel[] | null
  modelId: string
  threshold: number
  busy: boolean
  registeredSchemas: string[] | null
  pendingCount: number
  onRegister: (() => void) | null
  onTrain: () => void
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
          <SelectContent>{datasets.map(item => <SelectItem key={item.version} value={item.version}>{datasetVersionLabel(item.version).name} · {item.mine ? '我的数据' : '共享数据'}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground-2">固定模型</span>
        <Select value={modelId} onValueChange={onModel} disabled={!models?.length}>
          <SelectTrigger aria-label="试算模型"><SelectValue placeholder={models ? '没有兼容的已启用模型' : '正在读取模型'}/></SelectTrigger>
          <SelectContent>{(models ?? []).map(item => <SelectItem key={item.modelId} value={item.modelId}>{item.name}{item.mine ? ' · 我的' : item.shared ? ' · 共享' : ''}{item.isDefault ? ' · 默认' : ''}</SelectItem>)}</SelectContent>
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
        <span className="text-xs font-medium text-foreground-2">初始风险阈值</span>
        <strong className="text-sm tabular-nums text-foreground">{threshold.toFixed(2)}</strong>
      </div>
      <Slider label="初始风险阈值" value={[Math.round(threshold * 100)]} onValueChange={values => onThreshold(values[0] / 100)}/>
    </div>
    {selectedDataset && models && models.length === 0 ? <div className="grid gap-2 rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="status">
      <div className="flex gap-2">
        <ShieldAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14}/>
        <div className="grid min-w-0 gap-1 [overflow-wrap:anywhere]">
          <p>该数据版本需要 <code className="font-mono">{selectedDataset.schema}</code> 特征的已启用模型。</p>
          <p>你已启用模型的 schema：{registeredSchemas === null ? '正在读取…' : registeredSchemas.length
            ? <code className="font-mono">{registeredSchemas.join('、')}</code>
            : '暂无'}</p>
          <p>{pendingCount > 0 ? `有 ${pendingCount} 个使用相同 schema 的训练完成模型尚未登记。` : '还没有使用相同 schema 的训练完成模型。'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-5">
        {onRegister ? <Button size="sm" type="button" onClick={onRegister}>去登记 {pendingCount} 个模型</Button> : null}
        <Button size="sm" type="button" variant={onRegister ? 'outline' : 'default'} onClick={onTrain}>{onRegister ? '训练新模型' : '去训练'}</Button>
      </div>
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
  const savedTick = Math.round(detail.threshold * 100)
  const [tick, setTick] = useState(savedTick)
  const [metric, setMetric] = useState<Metric>('precision')
  const preview = detail.thresholdPreview
  const hit = preview.truePositives[tick]
  const falseAlarm = preview.falsePositives[tick]
  const missed = preview.positives - hit
  const flagged = hit + falseAlarm
  const precision = hit + falseAlarm ? hit / (hit + falseAlarm) : 0
  const recall = preview.positives ? hit / preview.positives : 0
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0
  const labelTotal = Object.values(detail.labelStatusCounts).reduce((sum, value) => sum + value, 0)
  return <>
    <section className="overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl [overflow-wrap:anywhere] font-semibold tracking-tight">{detail.dataset}</h2>
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
        <MetricCell label="初始阈值" value={detail.threshold.toFixed(2)}/>
        <MetricCell label="归因覆盖" value={`${detail.explanationCoverage.recorded}/${detail.explanationCoverage.limit}`}/>
      </dl>
    </section>

    <section className="grid gap-5 rounded-xl border border-border-soft bg-card p-5" aria-labelledby="prediction-threshold-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="prediction-threshold-title" className="text-sm font-semibold">阈值与指标</h2><p className="mt-0.5 text-[11px] text-foreground-4">分数达到阈值的提交计入告警</p></div>
        <div className="flex items-center gap-2">
          <output className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-semibold tabular-nums" htmlFor="prediction-threshold">阈值 {(tick / 100).toFixed(2)}</output>
          {tick !== savedTick ? <Button variant="ghost" size="sm" type="button" onClick={() => setTick(savedTick)}>重置为初始值</Button> : null}
        </div>
      </div>
      <Slider label="风险分数阈值" value={[tick]} onValueChange={values => setTick(values[0])}/>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 [&>div]:rounded-lg [&>div]:bg-sunken">
        <MetricCell label="告警" value={countText(flagged)}/>
        <MetricCell label="命中" value={countText(hit)}/>
        <MetricCell label="误报" value={countText(falseAlarm)}/>
        <MetricCell label="漏报" value={countText(missed)}/>
        <MetricCell label="精确率" value={ratio(precision)}/>
        <MetricCell label="召回率" value={ratio(recall)}/>
      </dl>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
        <ThresholdCurve detail={detail} metric={metric} tick={tick}/>
        <div className="grid gap-2">
          <span className="text-xs font-medium text-foreground-2">选择指标</span>
          {([['precision', '精确率'], ['recall', '召回率'], ['f1', 'F1']] as const).map(([id, label]) =>
            <Button key={id} type="button" variant="ghost" aria-pressed={metric === id} onClick={() => setMetric(id)}
              className={cn('flex h-auto w-full items-center justify-between rounded-lg border px-3 py-2 text-xs',
                metric === id ? 'border-accent/35 bg-accent-soft text-foreground' : 'border-border-soft hover:bg-sunken')}>
              <span>{label}</span><strong className="tabular-nums">{id === 'precision' ? ratio(precision) : id === 'recall' ? ratio(recall) : ratio(f1)}</strong>
            </Button>)}
          <p className="text-xs text-foreground-3">按现有标签计算。</p>
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

function ThresholdCurve({ detail, metric, tick }: { detail: PredictionBatchDetail; metric: Metric; tick: number }) {
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
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: colors.axis }, data: [{ xAxis: preview.thresholds[tick].toFixed(2) }] },
      markPoint: { silent: true, symbol: 'circle', symbolSize: 9, label: { show: false }, data: [{ name: '当前阈值', coord: [preview.thresholds[tick].toFixed(2), series[tick]] }] },
    }],
  }
  return <EChartCanvas option={option} height={260} label="随风险阈值变化的指标曲线"/>
}
