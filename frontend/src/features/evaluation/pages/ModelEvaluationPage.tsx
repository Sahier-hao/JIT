import { ArrowRight, FlaskConical, Gauge, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { EChartCanvas, useChartColors, type ChartOption } from '@/components/shared/EChartCanvas'
import { DocsHelpLink } from '@/features/docs/components/DocsHelpLink'
import { ApiError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import type { Route } from '@/app/navigation'
import {
  userComparison, userExperiments,
} from '@/features/account/userClient'
import type {
  TrainingExperiment, TrainingExperimentComparison,
} from '@/features/admin/adminContracts'
import {
  fetchThresholdEvaluation, thresholdCandidate, type ThresholdEvaluation,
} from '@/features/training/trainingComparison'
import { trainingMethodName } from '@/features/training/trainingPresentation'
import {
  predictionBatches, predictionEvaluation,
  type PredictionBatch, type PredictionEvaluation,
} from '@/features/predictions/predictionClient'
import { evaluationPoint, type EvaluationPoint } from '@/features/evaluation/evaluationMetrics'

type Source = 'training' | 'prediction'
type LabelPolicyView = {
  version: string
  included: string[]
  excludedCounts: Record<string, number>
} | null
type SampleCountsView = {
  included: number
  positives: number
  negatives: number
  excluded: number
} | null

function percent(value: number | null) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function count(value: number) {
  return value.toLocaleString('zh-CN')
}

function sourceLabel(source?: Source) {
  return source === 'training' ? '评估本次训练' : source === 'prediction' ? '评估预测结果' : '模型评估'
}

export function ModelEvaluationPage({
  source, experimentId, taskId, modelId, batchId, navigate, onLoginRequired,
}: {
  source?: Source
  experimentId?: string
  taskId?: string
  modelId?: string
  batchId?: string
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [experiments, setExperiments] = useState<TrainingExperiment[] | null>(null)
  const [batches, setBatches] = useState<PredictionBatch[] | null>(null)
  const [comparison, setComparison] = useState<TrainingExperimentComparison | null>(null)
  const [prediction, setPrediction] = useState<PredictionEvaluation | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState(taskId ?? '')
  const [tick, setTick] = useState(50)
  const [testEvaluation, setTestEvaluation] = useState<ThresholdEvaluation | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  function fail(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
    else setError(failure instanceof Error ? failure.message : fallback)
  }

  useEffect(() => {
    if (!source) return
    const controller = new AbortController()
    setError('')
    if (source === 'training') {
      setPrediction(null)
      setBatches(null)
      if (!experimentId) {
        setLoading(true)
        userExperiments(controller.signal).then(value => {
          if (!controller.signal.aborted) setExperiments(value.filter(experiment =>
            experiment.tasks.some(task => task.status === 'succeeded' && task.modelId)))
        }).catch(failure => {
          if (!controller.signal.aborted) fail(failure, '训练记录读取失败')
        }).finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
      }
      return () => controller.abort()
    }
    setComparison(null)
    setExperiments(null)
    if (!batchId) setLoading(true)
    predictionBatches(controller.signal).then(value => {
      if (!controller.signal.aborted) setBatches(value)
    }).catch(failure => {
      if (!controller.signal.aborted) fail(failure, '预测批次读取失败')
    }).finally(() => {
      if (!controller.signal.aborted && !batchId) setLoading(false)
    })
    return () => controller.abort()
  }, [source, experimentId, batchId, onLoginRequired])

  useEffect(() => {
    if (source !== 'training' || !experimentId) return
    const controller = new AbortController()
    setLoading(true)
    setComparison(null)
    setTestEvaluation(null)
    userComparison(experimentId, controller.signal)
      .then(next => {
        if (controller.signal.aborted) return
        setComparison(next)
        const candidates = next.methods.filter(method => method.status === 'succeeded')
        const chosen = candidates.find(method => method.taskId === taskId)
          ?? candidates.find(method => method.modelId === modelId)
          ?? candidates[0]
        setSelectedTaskId(chosen?.taskId ?? '')
      })
      .catch(failure => {
        if (!controller.signal.aborted) fail(failure, '训练评估读取失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [source, experimentId, taskId, modelId, onLoginRequired])

  useEffect(() => {
    if (source !== 'prediction' || !batchId) return
    const controller = new AbortController()
    setLoading(true)
    setPrediction(null)
    predictionEvaluation(batchId, controller.signal).then(value => {
      if (!controller.signal.aborted) setPrediction(value)
    }).catch(failure => {
      if (!controller.signal.aborted) fail(failure, '预测评估读取失败')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [source, batchId, onLoginRequired])

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    request.current?.abort()
    setTestEvaluation(null)
  }, [selectedTaskId, source, batchId])

  const methods = comparison?.methods.filter(method => method.status === 'succeeded' && method.modelId) ?? []
  const method = methods.find(item => item.taskId === selectedTaskId) ?? null
  const trainingCandidate = method ? thresholdCandidate(method) : null
  const preview = source === 'training' ? trainingCandidate?.preview ?? null : prediction?.thresholdPreview ?? null
  const point = preview ? evaluationPoint(preview, tick) : null

  async function evaluateTrainingTest() {
    if (!comparison || !method || !trainingCandidate) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const value = await fetchThresholdEvaluation(comparison, 'user', {
        taskIds: [method.taskId],
        strategy: 'fixed',
        threshold: tick / 100,
      }, controller.signal)
      if (controller.signal.aborted || selectedTaskId !== method.taskId) return
      setTestEvaluation(value)
    } catch (failure) {
      if (!controller.signal.aborted) fail(failure, '测试集复核失败')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (request.current === controller) request.current = null
    }
  }

  function chooseSource(next: Source) {
    setError('')
    navigate({ name: 'model-evaluation', source: next })
  }

  const testEvidence = testEvaluation?.methods[0]?.evaluation ?? null
  const predictionFormal = prediction?.eligible === true && prediction.partition === 'test'
  const formal = source === 'training'
    ? testEvidence?.formalAvailable === true
    : predictionFormal
  const mode = source === 'training'
    ? testEvidence?.mode
    : predictionFormal ? 'formal' as const : 'exploratory' as const
  const reason = source === 'training'
    ? testEvidence?.formalUnavailableReason
    : prediction
      ? predictionFormal ? null
        : prediction.eligible
          ? '预测批次未声明固定测试分区，只能进行探索性复核'
          : prediction.reason
      : null
  const sampleCounts = source === 'training'
    ? testEvidence?.sampleCounts
    : prediction ? {
        included: prediction.counts.labeledAvailable,
        positives: prediction.counts.positives,
        negatives: prediction.counts.negatives,
        excluded: prediction.counts.unavailable,
      } : null
  const predictionPolicy = prediction ? {
    version: 'mature-binary-v1',
    included: ['positive', 'unobserved'],
    excludedCounts: Object.fromEntries(
      Object.entries(prediction.labelStatusCounts)
        .filter(([status]) => status !== 'positive' && status !== 'unobserved'),
    ),
  } : null

  return <section className="mx-auto grid w-full max-w-[78rem] min-w-0 gap-5">
    <WorkspacePageHeader title={source ? sourceLabel(source) : '模型评估'}
      meta="用真实保存的模型输出、标签和缺陷阈值核对分类结果。"
      actions={<DocsHelpLink article="labels-and-metrics" section="evaluation-metrics" label="怎么看评估指标"/>}/>

    <section className="grid gap-3 rounded-xl border border-border-soft bg-card p-4 sm:p-5" aria-label="评估入口">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold">选择评估来源</h2>
          <p className="mt-1 text-xs text-foreground-3">训练使用固定验证与测试分区；预测结果读取已保存批次，不重新推理。</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={source === 'training' ? 'default' : 'outline'} onClick={() => chooseSource('training')}>
            <FlaskConical aria-hidden="true"/>评估本次训练
          </Button>
          <Button type="button" size="sm" variant={source === 'prediction' ? 'default' : 'outline'} onClick={() => chooseSource('prediction')}>
            <Gauge aria-hidden="true"/>评估预测结果
          </Button>
        </div>
      </div>

      {source === 'training' ? <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">训练实验</span>
          <Select value={experimentId ?? ''} onValueChange={value => navigate({ name: 'model-evaluation', source: 'training', experimentId: value })}>
            <SelectTrigger aria-label="评估训练实验"><SelectValue placeholder={loading ? '正在读取训练记录' : '选择有训练结果的实验'}/></SelectTrigger>
            <SelectContent>{(experiments ?? []).map(item => <SelectItem key={item.experimentId} value={item.experimentId}>
              {item.datasetVersion} · {item.experimentId.slice(0, 8)}
            </SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">模型</span>
          <Select value={selectedTaskId} onValueChange={value => { setSelectedTaskId(value); setTick(50) }}
            disabled={!methods.length}>
            <SelectTrigger aria-label="评估训练模型"><SelectValue placeholder="选择已成功训练的方法"/></SelectTrigger>
            <SelectContent>{methods.map(item => <SelectItem key={item.taskId} value={item.taskId}>
              {trainingMethodName(item.method, item.methodName)}{item.modelId ? ' · 已登记到模型库' : ' · 尚未登记'}
            </SelectItem>)}</SelectContent>
          </Select>
        </label>
      </div> : source === 'prediction' ? <label className="grid max-w-xl gap-1.5">
        <span className="text-xs font-medium text-foreground-2">已保存预测批次</span>
        <Select value={batchId ?? ''} onValueChange={value => navigate({ name: 'model-evaluation', source: 'prediction', batchId: value })}>
          <SelectTrigger aria-label="评估预测批次"><SelectValue placeholder={loading ? '正在读取预测批次' : '选择已保存预测批次'}/></SelectTrigger>
          <SelectContent>{(batches ?? []).map(item => <SelectItem key={item.batchId} value={item.batchId}>
            {item.dataset} · {item.model.name} · 阈值 {item.threshold.toFixed(2)}
          </SelectItem>)}</SelectContent>
        </Select>
      </label> : null}
      {source === 'prediction' && !batchId ? <Button className="w-fit" type="button" variant="outline"
        onClick={() => navigate({ name: 'my-predictions' })}>新建预测批次<ArrowRight aria-hidden="true"/></Button> : null}
    </section>

    {error ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">
      <span>{error}</span><Button size="sm" variant="outline" type="button" onClick={() => window.location.reload()}>重新读取</Button>
    </div> : null}

    {loading ? <LoadingNotice label="正在读取评估结果"/> : null}
    {!source ? <EmptyState title="选择评估来源" description="可以从一次已完成的训练，或一份已经保存的预测结果开始。"/> : null}
    {source === 'training' && !experimentId && !loading && experiments?.length === 0
      ? <EmptyState title="还没有可评估的训练"><Button type="button" onClick={() => navigate({ name: 'my-training' })}>开始训练</Button></EmptyState> : null}
    {source === 'prediction' && !batchId && !loading && batches?.length === 0
      ? <EmptyState title="还没有预测结果"><Button type="button" onClick={() => navigate({ name: 'my-predictions' })}>生成预测结果</Button></EmptyState> : null}

    {source === 'training' && comparison && method && preview ? <>
      <IdentityCard
        modelName={trainingMethodName(method.method, method.methodName)}
        modelId={testEvaluation?.methods[0]?.modelId ?? method.modelId}
        runId={testEvaluation?.methods[0]?.runId ?? method.runId}
        method={method.method}
        datasetVersion={comparison.datasetVersion}
        partition="冻结测试分区"
        memberSha256={comparison.methods.find(item => item.taskId === method.taskId)?.splitMemberSha256}
        mode={mode} formal={formal} reason={reason} sampleCounts={sampleCounts ?? null}
      />
      <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-4 sm:p-5" aria-label="验证集缺陷阈值">
        <div><h2 className="text-sm font-semibold">在验证集选择缺陷阈值</h2>
          <p className="mt-1 text-xs text-foreground-3">只看验证集；确认后才会用同一阈值读取冻结测试集。</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-foreground-3">缺陷阈值</span>
          <output className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-semibold tabular-nums">{(tick / 100).toFixed(2)}</output>
        </div>
        <Slider label="缺陷阈值" value={[tick]} onValueChange={values => { setTick(values[0]); setTestEvaluation(null) }}/>
        {point ? <EvaluationPanel point={point}/> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
          <p className="text-xs text-foreground-3">测试集目前未显示结果；下面是验证集工作点。</p>
          <Button type="button" disabled={busy || method.status !== 'succeeded'} onClick={() => void evaluateTrainingTest()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : null}
            {busy ? '正在复核测试集…' : '在测试集复核'}
          </Button>
        </div>
      </section>
      {testEvaluation?.methods[0] && testEvidence ? <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-4 sm:p-5" aria-label="测试集正式复核">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-sm font-semibold">冻结测试集结果</h2>
            <p className="mt-1 text-xs text-foreground-3">固定成员 · 阈值 {testEvaluation.methods[0].threshold.toFixed(2)}</p></div>
          <span className={cn('rounded-md px-2 py-1 text-xs font-medium',
            testEvidence.formalAvailable ? 'bg-accent-soft text-accent' : 'bg-amber-soft text-amber-deep')}>
            {testEvidence.formalAvailable ? '正式评估' : '探索性复核'}
          </span>
        </div>
        <ClassificationPanel value={testEvaluation.methods[0].test} threshold={testEvaluation.methods[0].threshold}/>
        <LabelPolicy policy={testEvidence.labelPolicy} sampleCounts={testEvidence.sampleCounts ?? null}/>
      </section> : null}
    </> : null}

    {source === 'prediction' && prediction && preview && point ? <>
      <IdentityCard
        modelName={prediction.model.name}
        modelId={prediction.model.modelId}
        runId={prediction.model.runId}
        method={prediction.model.method}
        datasetVersion={prediction.datasetVersion ?? '数据集未记录'}
        partition={prediction.partition === 'test' ? '固定测试分区' : '已保存预测批次'}
        memberSha256={prediction.memberSha256}
        mode={mode} formal={formal} reason={reason} sampleCounts={sampleCounts ?? null}
      />
      <section className="grid gap-4 rounded-xl border border-border-soft bg-card p-4 sm:p-5" aria-label="预测结果缺陷阈值">
        <div><h2 className="text-sm font-semibold">按保存结果调整缺陷阈值</h2>
          <p className="mt-1 text-xs text-foreground-3">只重算已保存风险，不重新调用模型。</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-foreground-3">缺陷阈值</span>
          <output className="rounded-lg bg-sunken px-3 py-1.5 text-sm font-semibold tabular-nums">{(tick / 100).toFixed(2)}</output>
        </div>
        <Slider label="缺陷阈值" value={[tick]} onValueChange={values => setTick(values[0])}/>
        <EvaluationPanel point={point}/>
        <LabelPolicy policy={predictionPolicy} sampleCounts={sampleCounts ?? null}/>
      </section>
    </> : null}
  </section>
}

function IdentityCard({
  modelName, modelId, runId, method, datasetVersion, partition, memberSha256,
  mode, formal, reason, sampleCounts,
}: {
  modelName: string
  modelId?: string | null
  runId?: string | null
  method?: string | null
  datasetVersion: string
  partition: string
  memberSha256?: string | null
  mode?: 'formal' | 'exploratory'
  formal?: boolean
  reason?: string | null
  sampleCounts?: { included: number; positives: number; negatives: number; excluded: number } | null
}) {
  return <section className="overflow-hidden rounded-xl border border-border-soft bg-card">
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{modelName}</h2>
        <p className="mt-1 text-xs text-foreground-3">{method ?? '方法未提供'} · {partition}</p>
      </div>
      <span className={cn('rounded-md px-2 py-1 text-xs font-medium',
        formal ? 'bg-accent-soft text-accent' : 'bg-amber-soft text-amber-deep')}>
        {formal ? '正式评估' : mode === 'exploratory' ? '探索性复核' : '等待测试复核'}
      </span>
    </div>
    <dl className="grid grid-cols-2 divide-x divide-y divide-border-soft border-t border-border-soft text-xs sm:grid-cols-4 sm:divide-y-0 [&>div]:min-w-0 [&>div]:px-4 [&>div]:py-3">
      <div><dt className="text-foreground-3">模型</dt><dd className="mt-1 break-all font-mono">{modelId ?? '尚未登记'}</dd></div>
      <div><dt className="text-foreground-3">运行</dt><dd className="mt-1 break-all font-mono">{runId ?? '—'}</dd></div>
      <div><dt className="text-foreground-3">数据</dt><dd className="mt-1 break-all">{datasetVersion}</dd></div>
      <div><dt className="text-foreground-3">参与样本</dt><dd className="mt-1 tabular-nums">
        {sampleCounts ? `${count(sampleCounts.included)}（正 ${count(sampleCounts.positives)} / 负 ${count(sampleCounts.negatives)}）` : '待测试复核'}
      </dd></div>
    </dl>
    {memberSha256 ? <p className="border-t border-border-soft px-4 py-2 font-mono text-[11px] text-foreground-4 sm:px-5">成员摘要 {memberSha256}</p> : null}
    {reason ? <p className="flex gap-2 border-t border-amber/20 bg-amber-soft px-4 py-2 text-xs text-amber-deep sm:px-5"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true"/>{reason}</p> : null}
  </section>
}

function EvaluationPanel({ point }: { point: EvaluationPoint }) {
  const colors = useChartColors()
  const option: ChartOption = {
    animation: false,
    color: [colors.series],
    grid: { left: 42, right: 16, top: 20, bottom: 34 },
    xAxis: { type: 'category', data: ['告警', '命中', '误报', '漏报'] },
    yAxis: { type: 'value', min: 0, axisLabel: { color: colors.text } },
    series: [{ type: 'bar', name: '样本数', data: [point.alerts, point.hits, point.falseAlarms, point.missed], barMaxWidth: 48 }],
  }
  return <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,32rem)]">
    <EChartCanvas option={option} height={230} label="缺陷阈值计数条形图"/>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs tabular-nums" aria-label="缺陷阈值指标表">
        <thead className="bg-sunken text-foreground-3"><tr><th scope="col" className="px-2 py-2">缺陷阈值</th><th scope="col" className="px-2 py-2 text-right">告警</th><th scope="col" className="px-2 py-2 text-right">命中</th><th scope="col" className="px-2 py-2 text-right">误报</th><th scope="col" className="px-2 py-2 text-right">漏报</th><th scope="col" className="px-2 py-2 text-right">Precision</th><th scope="col" className="px-2 py-2 text-right">Recall</th><th scope="col" className="px-2 py-2 text-right">F1</th></tr></thead>
        <tbody><tr className="border-t border-border-soft"><td className="px-2 py-2">{point.threshold.toFixed(2)}</td><td className="px-2 py-2 text-right">{count(point.alerts)}</td><td className="px-2 py-2 text-right">{count(point.hits)}</td><td className="px-2 py-2 text-right">{count(point.falseAlarms)}</td><td className="px-2 py-2 text-right">{count(point.missed)}</td><td className="px-2 py-2 text-right">{percent(point.precision)}</td><td className="px-2 py-2 text-right">{percent(point.recall)}</td><td className="px-2 py-2 text-right">{percent(point.f1)}</td></tr></tbody>
      </table>
    </div>
  </div>
}

function ClassificationPanel({ value, threshold }: { value: { confusion: { tp: number; fp: number; tn: number; fn: number }; precision: { value: number | null }; recall: { value: number | null }; f1: { value: number | null } }; threshold: number }) {
  const point: EvaluationPoint = {
    threshold,
    alerts: value.confusion.tp + value.confusion.fp,
    hits: value.confusion.tp,
    falseAlarms: value.confusion.fp,
    missed: value.confusion.fn,
    precision: value.precision.value,
    recall: value.recall.value,
    f1: value.f1.value,
  }
  return <EvaluationPanel point={point}/>
}

function LabelPolicy({ policy, sampleCounts }: {
  policy: LabelPolicyView
  sampleCounts: SampleCountsView
}) {
  if (!policy) return null
  return <div className="grid gap-2 border-t border-border-soft pt-3">
    <p className="text-xs font-medium text-foreground-2">可靠标签口径</p>
    <p className="text-xs text-foreground-3">
      纳入：{policy.included.join('、') || '无'}。以下状态未进入指标：
      {sampleCounts ? ` 共排除 ${count(sampleCounts.excluded)} 条。` : ''}
    </p>
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(policy.excludedCounts).map(([status, value]) =>
        <span key={status} className="rounded-md bg-sunken px-2 py-1 text-[11px] text-foreground-3">{status} {count(value)}</span>)}
    </div>
  </div>
}
