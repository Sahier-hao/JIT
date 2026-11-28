import { Activity, BookOpenText, Check, CircleAlert, Clock3, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { TrainingLossChart } from '@/components/shared/TrainingLossChart'
import { formatMethodParams } from '@/lib/methodParams'
import { cn } from '@/lib/utils'
import type { TrainingExperiment, TrainingTask } from '@/features/admin/adminContracts'
import { datasetVersionLabel, splitPresetLabel } from '@/lib/datasetLabel'
import { isActiveTraining, trainingMethodName, trainingPhase, trainingStatus } from '@/features/training/trainingPresentation'

const DEEP = new Set(['mlp-v1', 'wide-deep-v1', 'tabular-resnet-v1', 'ft-transformer-v1'])
const RETRYABLE = new Set(['failed', 'cancelled', 'interrupted'])
const PHASE_LABELS = ['排队', '训练', '评估与保存', '已保存结果']
function TaskStatus({ task }: { task: TrainingTask }) {
  const style = trainingStatus[task.status]
  return <span className={cn('inline-flex items-center gap-1.5 text-xs', style.color)}>
    <span className={cn('size-1.5 shrink-0 rounded-full', style.dot)} aria-hidden="true"/>
    {task.cancelRequestedAt && isActiveTraining(task.status) ? '正在取消' : style.label}
  </span>
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

export function TrainingExperimentMonitor({ experiment, busy, onAction, onRegister, onEvaluate, onOpenDataset, onOpenAlgorithm }: {
  experiment: TrainingExperiment
  busy: string
  onAction: (task: TrainingTask, action: 'cancel' | 'retry') => void
  onRegister: (task: TrainingTask) => void
  onEvaluate: (task: TrainingTask) => void
  onOpenDataset?: () => void
  onOpenAlgorithm?: (method: string) => void
}) {
  const [selectedMethod, setSelectedMethod] = useState<string>()
  const monitor = useRef<HTMLElement>(null)
  const tasks = experiment.tasks
  const selected = tasks.find(task => task.method === selectedMethod)
    ?? tasks.find(task => task.status === 'running') ?? tasks[0]
  const finished = tasks.filter(task => !isActiveTraining(task.status)).length
  const history = selected?.trainingHistory
  const last = history?.entries.at(-1)
  const latestTrain = last?.trainEvalLoss ?? last?.trainLoss
  const eta = selected?.status === 'running' && !selected.cancelRequestedAt ? remainingFitTime(history ?? null) : null
  const hasLoss = history?.entries.some(entry => entry.trainLoss != null || entry.trainEvalLoss != null || entry.validationLoss != null)
  const method = selected && trainingMethodName(selected.method)
  const split = splitPresetLabel(experiment.splitPreset)
  const dataset = datasetVersionLabel(experiment.datasetVersion)
  const active = selected ? isActiveTraining(selected.status) : false
  const phase = selected ? trainingPhase(selected) : null
  const retryable = selected ? RETRYABLE.has(selected.status) : false

  function selectTask(method: string) {
    setSelectedMethod(method)
    if (window.matchMedia?.('(max-width: 1279px)').matches) {
      monitor.current?.scrollIntoView({ block: 'start' })
      monitor.current?.focus({ preventScroll: true })
    }
  }

  return <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
    <section ref={monitor} tabIndex={-1} aria-label="训练可视化" className="grid min-w-0 grid-cols-1 content-start gap-4 rounded-xl border border-border-soft bg-card p-4 outline-none sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground-3">训练过程</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-xl font-semibold [overflow-wrap:anywhere]">{method ?? '等待训练任务'}</p>
            {selected && onOpenAlgorithm ? <Button type="button" size="xs" variant="ghost" onClick={() => onOpenAlgorithm(selected.method)}>
              <BookOpenText aria-hidden="true" size={13}/>算法说明
            </Button> : null}
          </div>
        </div>
        {selected ? <Badge variant="outline"><TaskStatus task={selected}/></Badge> : null}
      </div>
      {phase !== null ? <ol aria-label="训练阶段" className="grid grid-cols-2 gap-1.5 rounded-lg bg-sunken p-1.5 text-xs sm:grid-cols-4">
        {PHASE_LABELS.map((label, index) => <li key={label} aria-current={phase === index ? 'step' : undefined}
          className={cn('flex min-w-0 items-center gap-1.5 rounded-md px-2 py-2', phase === index ? 'bg-card font-semibold text-accent shadow-xs' : 'text-foreground-3')}>
          {index < phase ? <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true"/> : <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', index === phase ? 'bg-accent' : 'bg-foreground-4')}/>}
          {label}
        </li>)}
      </ol> : null}
      {selected && retryable ? <section aria-label="训练停止原因" className="flex flex-wrap items-start gap-3 rounded-lg border border-border-soft bg-sunken p-3 text-sm sm:flex-nowrap">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-deep" aria-hidden="true"/>
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]" role="status">
          <p className="font-semibold">{trainingStatus[selected.status].label}{last ? ` · 已记录 ${last.epoch} / ${history?.epochs} 轮` : ''}</p>
          {selected.error ? <p className="mt-1 text-rose-deep">{selected.error.message}</p> : null}
          <p className="mt-1 text-xs text-foreground-3">重试会创建新任务，从头训练。</p>
        </div>
        <Button size="sm" type="button" variant="outline" disabled={Boolean(busy)} onClick={() => onAction(selected, 'retry')}>
          {busy === selected.taskId ? <><LoaderCircle className="motion-safe:animate-spin" aria-hidden="true"/>正在重试…</> : '重试'}
        </Button>
      </section> : null}
      {selected && history && last ? <div className="grid gap-2 border-t border-border-soft pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground-3">
          <span>已完成轮次 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{last.epoch} / {history.epochs}</strong></span>
          {latestTrain == null ? null : <span>最新训练损失 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{latestTrain.toFixed(4)}</strong></span>}
          {last.validationLoss == null ? null : <span>最新验证损失 <strong className="ml-1 text-lg font-semibold tabular-nums text-foreground">{last.validationLoss.toFixed(4)}</strong></span>}
        </div>
        <Progress value={history.epochs > 0 ? Math.min(100, last.epoch / history.epochs * 100) : 0} aria-label="训练轮次进度"/>
        {eta ? <p className="text-xs text-foreground-3">预计拟合剩余时间 {eta}</p> : null}
      </div> : null}
      {selected ? hasLoss && history ? <div className="min-w-0 rounded-lg border border-border-soft pt-3">
        <h3 className="px-4 pb-1 text-xs font-medium text-foreground-2">损失曲线</h3>
        <TrainingLossChart history={history} method={method ?? selected.method} height={253} stopped={!active}/>
      </div> : <LossPlaceholder task={selected}/> : null}
        {selected ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
          {selected.parameters ? <details className="min-w-0 text-xs text-foreground-3">
          <summary className="cursor-pointer">训练参数</summary>
          <p className="mt-2 [overflow-wrap:anywhere]">{formatMethodParams(selected.parameters)}</p>
        </details> : <span className="text-xs text-foreground-3">默认参数</span>}
          {active ? <Button size="sm" type="button" variant="outline" disabled={Boolean(busy || selected.cancelRequestedAt)}
          onClick={() => onAction(selected, 'cancel')}>
          {busy === selected.taskId ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true"/> : null}
          {busy === selected.taskId || selected.cancelRequestedAt ? '正在取消…' : '取消'}
          </Button> : null}
          {selected.status === 'succeeded' ? selected.modelId
            ? <Button size="sm" type="button" onClick={() => onEvaluate(selected)}>评估本次训练</Button>
            : <Button size="sm" type="button" disabled={Boolean(busy)} onClick={() => onRegister(selected)}>
              {busy === selected.taskId ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true"/> : null}
              登记到模型库
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
          <Button type="button" variant="ghost" aria-pressed={task.taskId === selected?.taskId} onClick={() => selectTask(task.method)}
            className="grid h-auto w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] justify-items-start gap-2 whitespace-normal rounded-md border border-transparent px-2.5 py-2 text-left aria-pressed:border-accent/30 aria-pressed:bg-accent-soft">
            <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
              {trainingMethodName(task.method)}
              {task.status === 'succeeded' ? <span className="ml-1 text-[10px] font-normal text-foreground-4">
                {task.modelId ? '已登记到模型库' : '尚未登记'}
              </span> : null}
            </span>
            <TaskStatus task={task}/>
          </Button>
        </li>)}
      </ul>
      <dl className="grid gap-3 border-t border-border-soft pt-3 [&_dd]:mt-0.5 [&_dt]:text-xs [&_dt]:text-foreground-3">
        <div><dt>数据</dt><dd className="text-xs [overflow-wrap:anywhere]" title={experiment.datasetVersion}>{dataset.name}</dd>
          {dataset.range ? <dd className="mt-0.5 text-xs text-foreground-3">{dataset.range}</dd> : null}
          {onOpenDataset ? <Button variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={onOpenDataset} type="button">打开训练数据</Button> : null}
        </div>
        <div><dt>时间切分</dt><dd className="text-sm">{split}</dd></div>
      </dl>
    </aside>

  </div>
}
