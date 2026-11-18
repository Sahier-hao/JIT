import { AlertTriangle, Check, LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import type { DatasetBuildRangeMode } from '@/features/datasets/components/DatasetBuildRange'

const ACTIVE = ['queued', 'running']
const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '构建中', completed: '已完成', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}
const STAGE_LABELS: Record<string, string> = {
  queued: '等待采集', collecting: '采集中', registering: '登记中',
  completed: '完成', failed: '失败', cancelled: '取消', interrupted: '中断',
}
const BUILD_FLOW = [
  { id: 'queued', label: '排队', description: '等待数据集构建 worker 接手。' },
  { id: 'collecting', label: '采集与打标', description: '读取 Git 历史，计算 14 维提交特征，并生成 SZZ 标签。' },
  { id: 'registering', label: '质量检查与登记', description: '按纳入规则清洗，写入 CSV、manifest 与数据版本。' },
  { id: 'completed', label: '完成', description: '数据版本进入“我的数据”，可以查看或用于训练。' },
] as const

function buildStageIndex(task: DatasetBuildTask | null): number {
  if (!task) return -1
  if (task.status === 'completed') return BUILD_FLOW.length - 1
  if (task.stage === 'registering') return 2
  if (task.stage === 'collecting' || task.status === 'running') return 1
  return 0
}

export function DatasetBuildFlow({ task }: { task: DatasetBuildTask | null }) {
  const stageIndex = buildStageIndex(task)
  const failed = Boolean(task && ['failed', 'cancelled', 'interrupted'].includes(task.status))
  const active = Boolean(task && ACTIVE.includes(task.status))
  return <section className="rounded-lg border border-border-soft bg-card p-3" aria-label="数据集构建流程">
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="text-xs font-medium text-foreground-2">构建流程</h2>
      <span className="text-[11px] text-foreground-4">{task ? '实时更新' : '开始后逐步执行'}</span>
    </div>
    <ol className="grid gap-0">
      {BUILD_FLOW.map((step, index) => {
        const complete = stageIndex > index || task?.status === 'completed'
        const current = stageIndex === index && !complete
        const currentFailed = current && failed
        return <li key={step.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
          <div className="flex flex-col items-center">
            <span className={cn(
              'grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-medium',
              complete ? 'border-teal bg-teal text-white'
                : currentFailed ? 'border-rose bg-rose text-white'
                : current ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-soft bg-sunken text-foreground-4',
            )}>
              {complete ? <Check aria-hidden="true" size={11}/> : currentFailed ? <AlertTriangle aria-hidden="true" size={11}/> : current ? <LoaderCircle aria-hidden="true" className="animate-spin" size={11}/> : index + 1}
            </span>
            {index < BUILD_FLOW.length - 1 ? <span className={cn('my-1 w-px flex-1', complete ? 'bg-teal/40' : 'bg-border-soft')} aria-hidden="true"/> : null}
          </div>
          <div className={cn('min-w-0 pb-3', index === BUILD_FLOW.length - 1 && 'pb-0')}>
            <div className="flex items-center gap-2">
              <strong className={cn('text-xs font-medium', complete || current ? 'text-foreground' : 'text-foreground-3')}>{step.label}</strong>
              {current && active ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">{task?.status === 'queued' ? '排队中' : '进行中'}</span> : null}
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-foreground-3">{step.description}</p>
          </div>
        </li>
      })}
    </ol>
  </section>
}

export function DatasetBuildRangeField({
  mode, onModeChange, since, until, onSinceChange, onUntilChange, disabled = false, labelPrefix = '',
}: {
  mode: DatasetBuildRangeMode
  onModeChange: (value: DatasetBuildRangeMode) => void
  since: string
  until: string
  onSinceChange: (value: string) => void
  onUntilChange: (value: string) => void
  disabled?: boolean
  labelPrefix?: string
}) {
  return <>
    <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">采集范围</span>
      <Select value={mode} onValueChange={value => onModeChange(value as DatasetBuildRangeMode)} disabled={disabled}>
        <SelectTrigger aria-label={labelPrefix ? `${labelPrefix}采集范围` : '采集范围'}><SelectValue/></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部历史（最多 50,000 次提交）</SelectItem>
          <SelectItem value="1y">最近 1 年</SelectItem>
          <SelectItem value="90d">最近 90 天</SelectItem>
          <SelectItem value="custom">自定义日期</SelectItem>
        </SelectContent>
      </Select>
    </label>
    {mode === 'custom' ? <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">开始日期</span><Input aria-label={labelPrefix ? `${labelPrefix}开始日期` : '开始日期'} type="date" value={since} onChange={event => onSinceChange(event.target.value)} disabled={disabled}/></label>
      <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">结束日期</span><Input aria-label={labelPrefix ? `${labelPrefix}结束日期` : '结束日期'} type="date" value={until} min={since || undefined} onChange={event => onUntilChange(event.target.value)} disabled={disabled}/></label>
    </div> : null}
  </>
}

export function DatasetBuildTaskSummary({ task }: { task: DatasetBuildTask | null }) {
  if (!task) return null
  return <section className="grid gap-2 rounded-sm border border-border-soft p-3" aria-label="数据集构建任务状态">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-sm font-semibold text-foreground">{STATUS_LABELS[task.status] ?? task.status}</strong>
      <span className="text-xs text-foreground-3">{STAGE_LABELS[task.stage] ?? task.stage}{task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''}</span>
    </div>
    {task.error ? <div className="rounded-sm border border-rose/30 bg-rose-soft p-2 text-xs text-rose-deep" role="alert"><strong>{task.error.code}</strong><p className="mt-0.5">{task.error.message}</p></div> : null}
    {task.status === 'completed' ? <>
      <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[88px_minmax(0,1fr)] [&>div]:gap-2 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
        <div><dt>数据版本</dt><dd><code>{task.datasetVersion}</code></dd></div>
        <div><dt>来源</dt><dd>{task.reused ? '复用同内容版本' : '新登记版本'}</dd></div>
        <div><dt>提交上限</dt><dd>{task.commitLimit.toLocaleString()}</dd></div>
        {task.quality ? <div><dt>纳入 / 正例</dt><dd>{String(task.quality.includedRows ?? '未知')} / {String(task.quality.positiveLabels ?? '未知')}</dd></div> : null}
        <div><dt>来源版本</dt><dd><code>{task.headCommit?.slice(0, 12) ?? '未记录'}</code></dd></div>
      </dl>
      <p className="text-xs leading-body text-foreground-3">数据集已冻结，不会自动训练或替换当前模型。</p>
    </> : null}
  </section>
}
