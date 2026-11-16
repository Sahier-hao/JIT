import { useEffect, useState } from 'react'
import { STATUS_LABELS, type SyncStatus } from '../repositoryContract'
import { cn } from '../lib/utils'

const STAGES = [
  { key: 'queued', label: '排队' },
  { key: 'collecting', label: '采集' },
  { key: 'registering', label: '登记' },
  { key: 'training', label: '训练' },
  { key: 'scoring', label: '评分' },
] as const

const ACTIVE: readonly string[] = ['queued', 'collecting', 'registering', 'training', 'scoring']
const RUNNING: readonly string[] = ['collecting', 'registering', 'training', 'scoring']

function stageIndex(status: SyncStatus, stage: SyncStatus) {
  if (status === 'completed') return STAGES.length
  if (status === 'queued') return 0
  const current = (RUNNING.includes(status) ? status : stage) as string
  const index = STAGES.findIndex(item => item.key === current)
  return index < 0 ? 0 : index
}

function elapsed(startedAt?: string | null) {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

const NODE_CLASS = {
  done: 'border-accent bg-accent',
  active: 'border-accent bg-card',
  failed: 'border-rose bg-rose',
  pending: 'border-border-strong bg-card',
} as const

/** 分析作业的阶段进度：排队、采集、登记、训练、评分，只展示服务端真实阶段。 */
export function JobProgress({ status, stage, queuePosition, startedAt, compact }: {
  status: SyncStatus
  stage: SyncStatus
  queuePosition?: number | null
  startedAt?: string | null
  compact?: boolean
}) {
  const [tick, setTick] = useState(0)
  const running = ACTIVE.includes(status)
  useEffect(() => {
    if (!running || !startedAt) return
    const timer = setInterval(() => setTick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [running, startedAt])
  const index = stageIndex(status, stage)
  const done = status === 'completed'
  const failed = status === 'failed'
  const stopped = status === 'cancelled' || status === 'interrupted'
  const value = done ? 100 : index === 0 ? 0 : Math.round((index / (STAGES.length - 1)) * 100)
  const fill = done ? 'bg-teal' : failed ? 'bg-rose' : stopped ? 'bg-foreground-4' : 'bg-accent'
  const meta = status === 'queued' && queuePosition
    ? `排队第 ${queuePosition} 位`
    : running && startedAt ? `已用 ${elapsed(startedAt)}` : ''
  void tick
  return <div className="grid gap-1.5">
    {!compact ? <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
      <span className="font-medium text-foreground-2">{STATUS_LABELS[status]}</span>
      {meta ? <span className="text-foreground-4">{meta}</span> : null}
    </div> : null}
    <div className="relative h-1.5 rounded-full bg-strong" role="progressbar" aria-label={compact ? `分析进度：${STATUS_LABELS[status]}` : undefined}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className={cn('block h-full rounded-full transition-[width]', fill)} style={{ width: `${value}%` }}/>
      {STAGES.map((item, position) => {
        const nodeState = done || position < index ? 'done' : failed && position === index ? 'failed' : position === index ? 'active' : 'pending'
        return <span key={item.key} className={cn('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border', NODE_CLASS[nodeState])}
          style={{ left: `${(position / (STAGES.length - 1)) * 100}%` }}/>
      })}
    </div>
    {!compact ? <div className="flex justify-between text-[11px] text-foreground-4">
      {STAGES.map((item, position) => {
        const nodeState = done || position < index ? 'done' : failed && position === index ? 'failed' : position === index ? 'active' : 'pending'
        return <span key={item.key} className={cn(nodeState === 'active' && 'font-medium text-foreground', nodeState === 'failed' && 'text-rose')}>{item.label}</span>
      })}
    </div> : null}
  </div>
}

/** 单一比例的进度条：用于批量 PR、远端检查等只有数量的流程。 */
export function ProgressBar({ value, state = 'running', label }: {
  value: number | null
  state?: 'running' | 'done' | 'failed' | 'queued'
  label?: string
}) {
  const fill = state === 'failed' ? 'bg-rose' : state === 'done' ? 'bg-teal' : state === 'queued' ? 'bg-foreground-4' : 'bg-accent'
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-strong" role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
    <span className={cn('block h-full rounded-full transition-[width]', fill, value === null && 'w-1/3 animate-pulse')}
      style={value === null ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}/>
  </div>
}
