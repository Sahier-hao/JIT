import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronRight, Clock3, Database, LoaderCircle } from 'lucide-react'
import { formatDate } from '@/features/admin/adminContracts'
import type { UserDataset } from '@/features/account/userClient'
import type { DatasetBuildTask } from '@/features/datasets/datasetBuildClient'
import {
  BUILD_ACTIVE, BUILD_RETRYABLE, BUILD_STAGE_LABELS, BUILD_STATUS_LABELS,
  numberText, repositoryLabel, timestampLabel, usageLabel,
} from '@/features/datasets/mydata/format'

export function DatasetRowList({ items, selected, onSelect }: {
  items: UserDataset[]
  selected: string
  onSelect: (version: string) => void
}) {
  if (!items.length) return <div className="grid justify-items-center gap-2 px-3 py-10 text-center">
    <Database aria-hidden="true" className="text-foreground-4" size={22} strokeWidth={1.5}/>
    <p className="text-xs text-foreground-3">没有匹配的数据版本</p>
  </div>
  return <div className="grid gap-1" role="listbox" aria-label="数据版本">
    {items.map(item => {
      const active = item.version === selected
      return <button key={item.version} type="button" role="option" aria-selected={active}
        className={cn(
          'group relative w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          active ? 'bg-accent-soft/70' : 'hover:bg-sunken',
        )}
        onClick={() => onSelect(item.version)}>
        {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true"/> : null}
        <span className="flex items-start justify-between gap-2">
          <strong className="min-w-0 truncate text-sm font-medium text-foreground">{item.dataset}</strong>
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-foreground-4">
            {numberText(item.quality.includedRows)}
            {active ? <ChevronRight aria-hidden="true" size={13}/> : null}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-foreground-3">
          <span>{usageLabel(item.usage)}</span>
          <span className="text-foreground-4">·</span>
          <span>{numberText(item.quality.includedRows)} 行</span>
          <span className="text-foreground-4">·</span>
          <span>{numberText(item.quality.positiveLabels)} 正例</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-4">{timestampLabel(item)}</span>
      </button>
    })}
  </div>
}

export function BuildTaskList({ tasks, busyTaskId, onOpen, onInspect, onAction }: {
  tasks: DatasetBuildTask[]
  busyTaskId: string
  onOpen: (version: string) => void
  onInspect: (taskId: string) => void
  onAction: (task: DatasetBuildTask, action: 'cancel' | 'retry') => void
}) {
  if (!tasks.length) return <div className="grid justify-items-center gap-2 px-3 py-10 text-center">
    <Clock3 aria-hidden="true" className="text-foreground-4" size={22} strokeWidth={1.5}/>
    <p className="text-xs text-foreground-3">暂无构建任务</p>
  </div>
  return <div className="grid gap-2" aria-label="最近构建">
    <p className="px-2 pt-1 text-xs font-medium text-foreground-3">最近构建</p>
    {tasks.slice(0, 8).map(task => {
      const active = BUILD_ACTIVE.has(task.status)
      const retryable = BUILD_RETRYABLE.has(task.status)
      return <div key={task.taskId} className="grid gap-2 rounded-lg border border-border-soft bg-sunken/60 p-3 text-xs">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('size-1.5 shrink-0 rounded-full', task.status === 'completed' ? 'bg-teal' : task.status === 'failed' ? 'bg-rose' : active ? 'bg-amber' : 'bg-foreground-4')} aria-hidden="true"/>
            <strong className="truncate text-sm font-medium text-foreground">{repositoryLabel(task.repositoryUrl)}</strong>
          </span>
          <span className="shrink-0 text-[11px] text-foreground-3">{BUILD_STATUS_LABELS[task.status] ?? task.status}</span>
        </div>
        <span className="truncate text-[11px] text-foreground-4">{task.branch} · {formatDate(task.createdAt)}</span>
        {active ? <span className="text-[11px] text-foreground-3">{BUILD_STAGE_LABELS[task.stage] ?? task.stage}{task.queuePosition ? ` · 队列 ${task.queuePosition}` : ''}</span> : null}
        {task.error ? <span className="break-all text-[11px] text-rose">{task.error.code}</span> : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" type="button" onClick={() => onInspect(task.taskId)}>任务详情</Button>
          {task.status === 'completed' && task.datasetVersion ? <Button size="sm" variant="outline" type="button" onClick={() => onOpen(task.datasetVersion!)}>查看数据</Button> : null}
          {active ? <Button size="sm" variant="destructive" type="button" disabled={busyTaskId === task.taskId} onClick={() => onAction(task, 'cancel')}>{busyTaskId === task.taskId ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}取消</Button> : null}
          {retryable ? <Button size="sm" variant="outline" type="button" disabled={busyTaskId === task.taskId} onClick={() => onAction(task, 'retry')}>{busyTaskId === task.taskId ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}重试</Button> : null}
        </div>
      </div>
    })}
  </div>
}
