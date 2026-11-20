import { Activity, Check, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TrainingLossChart } from '@/components/shared/TrainingLossChart'
import { formatMethodParams } from '@/lib/methodParams'
import { cn } from '@/lib/utils'
import type { Row, TrainingExperiment, TrainingTask } from '@/features/admin/adminContracts'
import { SPLIT_PRESETS } from '@/features/datasets/splitClient'
import { isActiveTraining, trainingMethodName, trainingStatus } from '@/features/training/trainingPresentation'
import { TrainingThresholdPreview } from '@/features/training/components/TrainingThresholdPreview'

const DEEP = new Set(['mlp-v1', 'wide-deep-v1', 'tabular-resnet-v1', 'ft-transformer-v1'])
const RETRYABLE = new Set(['failed', 'cancelled', 'interrupted'])
const PARTITIONS = [
  { key: 'test', label: '测试集' },
  { key: 'validation', label: '验证集' },
  { key: 'train', label: '训练集' },
] as const

function TaskStatus({ task }: { task: TrainingTask }) {
  const style = trainingStatus[task.status]
  return <span className={cn('inline-flex items-center gap-1.5 text-xs', style.color)}>
    <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} aria-hidden="true"/>
    {task.cancelRequestedAt && isActiveTraining(task.status) ? '正在取消' : style.label}
  </span>
}

export function trainingMetric(metrics: Row | null, key: string): string {
  const entry = metrics?.[key]
  const value = entry && typeof entry === 'object' ? (entry as Row).value : entry
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—'
}

function LossPlaceholder({ task }: { task: TrainingTask }) {
  const finished = task.status === 'succeeded'
  const queued = task.status === 'queued'
  const deep = DEEP.has(task.method)
  const Icon = queued ? Clock3 : finished ? Check : RETRYABLE.has(task.status) ? CircleAlert : Activity
  const message = queued ? task.queuePosition === null ? '等待开始' : `队列第 ${task.queuePosition} 位`
    : task.status === 'running' ? deep ? '等待第一轮损失' : '正在拟合模型'
    : finished ? deep ? '此任务未记录逐轮损失' : '单次拟合已完成'
    : '没有可用的损失记录'
  return <div className="grid min-h-[220px] place-content-center justify-items-center gap-3 rounded-lg border border-dashed border-border-soft bg-sunken/40 px-5 text-center">
    <Icon className="size-6 text-foreground-3" strokeWidth={1.5} aria-hidden="true"/>
    <p className="text-sm font-medium text-foreground-2">{message}</p>
  </div>
}

function remainingFitTime(history: TrainingTask['trainingHistory']) {
  if (!history) return null
  const lastEpoch = history.entries.at(-1)?.epoch ?? 0
  if (lastEpoch >= history.epochs) return null
  const times = history.entries.slice(-5).map(entry => entry.seconds)
    .filter(seconds => Number.isFinite(seconds) && seconds > 0).sort((a, b) => a - b)
  if (times.length < 3) return null
  const middle = Math.floor(times.length / 2)
  const perEpoch = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2
  const seconds = Math.ceil(perEpoch * (history.epochs - lastEpoch))
  return seconds < 60 ? `约 ${seconds} 秒` : `约 ${Math.ceil(seconds / 60)} 分钟`
}

export function TrainingExperimentMonitor({ experiment, busy, onAction, registration }: {
  experiment: TrainingExperiment
  busy: string
  onAction: (task: TrainingTask, action: 'cancel' | 'retry') => void
  registration: ReactNode
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const [partitionKey, setPartitionKey] = useState('test')
  const monitor = useRef<HTMLElement>(null)
  const tasks = experiment.tasks
  const selected = tasks.find(task => task.taskId === selectedId)
    ?? tasks.find(task => task.status === 'running') ?? tasks[0]
  const finished = tasks.filter(task => !isActiveTraining(task.status)).length
  const successful = tasks.filter(task => task.status === 'succeeded').length
  const history = selected?.trainingHistory
  const last = history?.entries.at(-1)
  const latestTrain = last?.trainEvalLoss ?? last?.trainLoss
  const eta = selected?.status === 'running' && !selected.cancelRequestedAt ? remainingFitTime(history ?? null) : null
  const hasLoss = history?.entries.some(entry => entry.trainLoss !== null)
  const method = selected && trainingMethodName(selected.method)
  const split = SPLIT_PRESETS.find(preset => preset.value === experiment.splitPreset)?.label ?? experiment.splitPreset
  const active = selected ? isActiveTraining(selected.status) : false
  const availablePartitions = PARTITIONS.flatMap(part => {
    const metrics = selected?.metricsByPartition?.[part.key] ?? (part.key === 'test' ? selected?.metrics : null)
    return metrics && typeof metrics === 'object' ? [{ ...part, metrics: metrics as Row }] : []
  })
  const partition = availablePartitions.find(part => part.key === partitionKey) ?? availablePartitions[0]

  function selectTask(taskId: string) {
    setSelectedId(taskId)
    if (window.matchMedia?.('(max-width: 1279px)').matches) {
      monitor.current?.scrollIntoView({ block: 'start' })
      monitor.current?.focus({ preventScroll: true })
    }
  }

  return <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
    <section ref={monitor} tabIndex={-1} aria-label="训练可视化" className="grid min-w-0 grid-cols-1 content-start gap-4 rounded-xl border border-border-soft bg-card p-4 outline-none sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground-3">训练监控</h2>
          <p className="mt-1 text-xl font-semibold [overflow-wrap:anywhere]">{method ?? '等待训练任务'}</p>
        </div>
        {selected ? <Badge variant="outline"><TaskStatus task={selected}/></Badge> : null}
      </div>
      {selected && history && last ? <div className="grid gap-2 border-t border-border-soft pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground-3">
          <span>已完成轮次 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{last.epoch} / {history.epochs}</strong></span>
          {latestTrain == null ? null : <span>最新训练损失 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{latestTrain.toFixed(4)}</strong></span>}
          {last.validationLoss == null ? null : <span>最新验证损失 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{last.validationLoss.toFixed(4)}</strong></span>}
        </div>
        <Progress value={history.epochs > 0 ? Math.min(100, last.epoch / history.epochs * 100) : 0} aria-label="训练轮次进度"/>
        {eta ? <p className="text-xs text-foreground-3">预计拟合剩余时间 {eta}</p> : null}
        {last.epoch >= history.epochs && selected.status === 'running' ? <p className="text-xs text-foreground-3">轮次已完成，正在评估并保存结果。</p> : null}
      </div> : null}
      {selected ? hasLoss && history ? <div className="min-w-0 rounded-lg border border-border-soft pt-3">
        <h3 className="px-4 pb-1 text-xs font-medium text-foreground-2">损失曲线</h3>
        <TrainingLossChart history={history} method={method ?? selected.method} height={253}/>
        <p className="pb-3 text-center text-xs text-foreground-3">训练轮次</p>
      </div> : <LossPlaceholder task={selected}/> : null}
      {selected?.error ? <p role="status" className="text-sm text-rose [overflow-wrap:anywhere]">{selected.error.message}</p> : null}
      {selected ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
        {selected.parameters ? <details className="min-w-0 text-xs text-foreground-3">
          <summary className="cursor-pointer">训练参数</summary>
          <p className="mt-2 [overflow-wrap:anywhere]">{formatMethodParams(selected.parameters)}</p>
        </details> : <span className="text-xs text-foreground-3">默认参数</span>}
        {active || RETRYABLE.has(selected.status) ? <Button size="sm" type="button" variant="outline" disabled={!!busy || !!(active && selected.cancelRequestedAt)}
          onClick={() => onAction(selected, active ? 'cancel' : 'retry')}>
          {busy === selected.taskId ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : null}
          {active ? '取消' : '重试'}
        </Button> : null}
      </div> : null}
    </section>

    <aside aria-label="实验概况" className="grid min-w-0 grid-cols-1 content-start gap-4 rounded-xl border border-border-soft bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <h2 className="text-sm font-semibold">训练任务</h2>
        <p className="text-xs text-foreground-3">{finished} / {tasks.length} 已结束</p>
      </div>
      <ul className="grid min-w-0 gap-1.5">
        {tasks.map(task => <li className="min-w-0" key={task.taskId}>
          <Button type="button" variant="ghost" aria-pressed={task.taskId === selected?.taskId} onClick={() => selectTask(task.taskId)}
            className="grid h-auto w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] justify-items-start gap-2 whitespace-normal rounded-md border border-transparent px-2.5 py-2 text-left aria-pressed:border-border-soft aria-pressed:bg-sunken">
            <span className="text-sm [overflow-wrap:anywhere]">{trainingMethodName(task.method)}</span>
            <TaskStatus task={task}/>
          </Button>
        </li>)}
      </ul>
      <dl className="grid gap-3 border-t border-border-soft pt-3 [&_dd]:mt-0.5 [&_dt]:text-xs [&_dt]:text-foreground-3">
        <div><dt>数据版本</dt><dd className="font-mono text-xs [overflow-wrap:anywhere]">{experiment.datasetVersion}</dd></div>
        <div><dt>时间切分</dt><dd className="text-sm">{split}</dd></div>
      </dl>
      {successful ? <div className="grid gap-2 border-t border-border-soft pt-3">
        {tasks.some(task => task.modelId) ? <p className="text-xs text-foreground-3">{tasks.filter(task => task.modelId).length} 个模型已登记</p> : null}
        {registration}
      </div> : null}
    </aside>

    {selected?.status === 'succeeded' && partition ? <section className="grid min-w-0 gap-2 xl:col-span-2" aria-label={`${partition.label}指标`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{partition.label}指标</h2>
        {availablePartitions.length > 1 ? <ToggleGroup type="single" value={partition.key} aria-label="数据分区"
          onValueChange={value => { if (value) setPartitionKey(value) }}>
          {availablePartitions.map(part => <ToggleGroupItem key={part.key} value={part.key} size="sm">{part.label}</ToggleGroupItem>)}
        </ToggleGroup> : null}
      </div>
      <dl className="grid grid-cols-2 divide-x divide-y divide-border-soft rounded-xl border border-border-soft bg-card sm:grid-cols-4 sm:divide-y-0">
        {([['PR-AUC', 'averagePrecision'], ['ROC-AUC', 'rocAuc'], ['F1', 'f1'], ['召回率', 'recall']] as const).map(([label, key]) =>
          <div key={key} className="space-y-1 px-4 py-3"><dt className="text-xs text-foreground-3">{label}</dt><dd className="text-xl font-semibold tabular-nums">{trainingMetric(partition.metrics, key)}</dd></div>)}
      </dl>
    </section> : null}
    {selected?.status === 'succeeded' ? <div className="min-w-0 xl:col-span-2">
      <TrainingThresholdPreview key={selected.taskId}
        data={(selected.metricsByPartition?.validation as Row | undefined)?.thresholdPreview}/>
    </div> : null}
  </div>
}
