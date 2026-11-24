import { Activity, ArrowUpRight, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { linkTo, type Route } from '@/app/navigation'
import { formatDate, type TrainingExperiment } from '@/features/admin/adminContracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Progress } from '@/components/ui/progress'
import { isActiveTraining, trainingMethodName, trainingStatus } from '@/features/training/trainingPresentation'
import { cn } from '@/lib/utils'

function methodNames(experiment: TrainingExperiment) {
  return [...new Set(experiment.tasks.map(task => trainingMethodName(task.method)))].join('、') || '暂无训练方法'
}

function ExperimentStatus({ experiment }: { experiment: TrainingExperiment }) {
  const status = trainingStatus[experiment.status]
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-current/20 px-2 py-0.5 text-xs font-medium', status?.color)}>
    <span className={cn('size-1.5 rounded-full', status?.dot ?? 'bg-foreground-4')} aria-hidden="true"/>
    {status?.label ?? experiment.status}
  </span>
}

export function TrainingExperimentList({ records, navigate, historyDatasetVersion }: {
  records: TrainingExperiment[]
  historyDatasetVersion?: string
  navigate: (route: Route) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const active = records.find(item => isActiveTraining(item.status))
  const runningTask = active?.tasks.find(task => task.status === 'running')
  const history = runningTask?.trainingHistory
  const epoch = history?.entries.at(-1)?.epoch
  const term = query.trim().toLowerCase()
  const openExperiment = (experimentId: string) => linkTo({ name: 'my-training', experimentId,
    ...(historyDatasetVersion ? { historyDatasetVersion } : {}),
  }, navigate)
  const past = records.filter(item => !isActiveTraining(item.status))
  const visible = past.filter(item => (filter === 'all' || (filter === 'completed') === (item.status === 'succeeded'))
    && `${item.datasetVersion} ${methodNames(item)} ${item.tasks.map(task => task.method).join(' ')}`.toLowerCase().includes(term))

  return <div className="grid min-w-0 grid-cols-1 gap-5">
    {active ? <section aria-label="当前训练" className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-border-soft bg-sunken/60 p-4 sm:p-5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border-soft bg-card text-accent">
            <Activity size={17} strokeWidth={1.7} aria-hidden="true"/>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold">当前训练</h2><ExperimentStatus experiment={active}/>
            </div>
            <p className="mt-1 text-base font-semibold [overflow-wrap:anywhere]">{runningTask ? trainingMethodName(runningTask.method) : methodNames(active)}</p>
            <p className="mt-1 font-mono text-xs text-foreground-3 [overflow-wrap:anywhere]">{active.datasetVersion}</p>
          </div>
        </div>
        <a {...openExperiment(active.experimentId)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-accent hover:bg-card focus-visible:outline-2 focus-visible:outline-accent">
          查看训练<ArrowUpRight size={14} aria-hidden="true"/>
        </a>
      </div>
      {history && epoch !== undefined && history.epochs > 0 ? <div className="grid gap-1.5 sm:pl-12">
        <span className="text-xs tabular-nums text-foreground-3">已完成 {epoch} / {history.epochs} 轮</span>
        <Progress value={Math.min(100, epoch / history.epochs * 100)} aria-label="当前训练轮次进度"/>
      </div> : null}
    </section> : null}

    <section aria-label="训练记录" className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">训练记录
          <span className="text-xs font-normal tabular-nums text-foreground-3">{past.length} 条</span>
        </h2>
        {past.length > 0 ? <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={filter} onValueChange={value => { if (value) setFilter(value) }} aria-label="筛选训练记录">
            <ToggleGroupItem value="all" size="sm">全部</ToggleGroupItem>
            <ToggleGroupItem value="completed" size="sm">已完成</ToggleGroupItem>
            <ToggleGroupItem value="other" size="sm">异常与中止</ToggleGroupItem>
          </ToggleGroup>
          <div className="relative min-w-0 max-sm:w-full">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-3" aria-hidden="true"/>
            <Input value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索训练记录"
              placeholder="搜索方法或数据版本" className="h-8 w-full pl-8 text-xs sm:w-52"/>
          </div>
        </div> : null}
      </div>
      {visible.length > 0 ? <>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(9rem,0.42fr)_8rem_1rem] gap-4 border-y border-border-soft bg-sunken/50 px-5 py-2 text-xs text-foreground-3 lg:grid">
          <span>方法与数据版本</span><span>创建时间</span><span>状态</span><span/>
        </div>
        <ul className="divide-y divide-border-soft max-lg:border-t max-lg:border-border-soft">
          {visible.map(item => {
            const registered = item.tasks.filter(task => task.modelId).length
            return <li key={item.experimentId} className="min-w-0">
              <a {...openExperiment(item.experimentId)}
                className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-sunken/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(9rem,0.42fr)_8rem_1rem]">
                <div className="min-w-0 max-lg:col-span-2">
                  <strong className="block text-sm font-semibold [overflow-wrap:anywhere]">{methodNames(item)}</strong>
                  <span className="mt-0.5 block truncate font-mono text-xs text-foreground-3" title={item.datasetVersion}>{item.datasetVersion}</span>
                </div>
                <time dateTime={item.createdAt} className="text-xs tabular-nums text-foreground-3">{formatDate(item.createdAt)}</time>
                <div className="grid justify-items-start gap-0.5">
                  <ExperimentStatus experiment={item}/>
                  {registered > 0 ? <span className="text-[11px] text-foreground-3">已登记 {registered} 个模型</span> : null}
                </div>
                <ChevronRight size={15} aria-hidden="true" className="hidden text-foreground-4 group-hover:text-foreground lg:block"/>
              </a>
            </li>
          })}
        </ul>
      </> : <div className="grid justify-items-start gap-2 border-t border-border-soft px-4 py-6 text-sm text-foreground-3 sm:px-5">
        <p>{past.length ? '没有符合条件的训练记录' : '暂无历史训练记录'}</p>
        {past.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</Button> : null}
      </div>}
    </section>
  </div>
}
