import { useEffect, useState } from 'react'
import { STATUS_LABELS, type SyncStatus } from '../repositoryContract'

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
  const state = done ? 'done' : failed ? 'failed' : stopped ? 'stopped' : status === 'queued' ? 'queued' : 'running'
  const meta = status === 'queued' && queuePosition
    ? `排队第 ${queuePosition} 位`
    : running && startedAt ? `已用 ${elapsed(startedAt)}` : ''
  void tick
  return <div className="job-progress" data-state={state} data-compact={compact || undefined}>
    {!compact ? <div className="job-progress-head">
      <span className="job-progress-title">{STATUS_LABELS[status]}</span>
      {meta ? <span className="job-progress-meta">{meta}</span> : null}
    </div> : null}
    <div className="job-progress-track" role="progressbar" aria-label={compact ? `分析进度：${STATUS_LABELS[status]}` : undefined}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="job-progress-fill" style={{ width: `${value}%` }}/>
      {STAGES.map((item, position) => {
        const nodeState = done || position < index ? 'done' : failed && position === index ? 'failed' : position === index ? 'active' : 'pending'
        return <span key={item.key} className="job-progress-node" data-state={nodeState}
          style={{ left: `${(position / (STAGES.length - 1)) * 100}%` }}/>
      })}
    </div>
    {!compact ? <div className="job-progress-legend">
      {STAGES.map((item, position) => <span key={item.key} data-state={done || position < index ? 'done' : failed && position === index ? 'failed' : position === index ? 'active' : 'pending'}>{item.label}</span>)}
    </div> : null}
  </div>
}

/** 单一比例的进度条：用于批量 PR、远端检查等只有数量的流程。 */
export function ProgressBar({ value, state = 'running', label }: {
  value: number | null
  state?: 'running' | 'done' | 'failed' | 'queued'
  label?: string
}) {
  return <div className="progress-bar" data-state={state} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
    <span className="progress-bar-fill" style={value === null ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}/>
  </div>
}
