import { Activity, Database, LoaderCircle, TrendingUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import type { Route } from '@/app/navigation'

export interface ActiveJob {
  id: string
  kind: 'collection' | 'training' | 'import'
  label: string
  detail: string
  progress?: number | null
  route: Route
}

function kindLabel(job: ActiveJob) {
  return job.kind === 'import' ? '导入中' : job.kind === 'collection' ? '采集中' : '训练中'
}

function kindName(job: ActiveJob) {
  return job.kind === 'import' ? '导入任务' : job.kind === 'collection' ? '采集任务' : '训练任务'
}

function JobIcon({ kind }: { kind: ActiveJob['kind'] }) {
  if (kind === 'import') return <Upload aria-hidden="true" size={15}/>
  return kind === 'collection' ? <Database aria-hidden="true" size={15}/> : <TrendingUp aria-hidden="true" size={15}/>
}

export function ActiveJobsIndicator({ jobs, navigate }: {
  jobs: ActiveJob[]
  navigate: (route: Route) => void
}) {
  if (!jobs.length) return null
  if (jobs.length === 1) {
    const job = jobs[0]
    return <Button
      aria-label={`返回${kindName(job)}：${job.label}`}
      className="gap-1.5"
      size="sm"
      title={`${job.label} · ${job.detail}`}
      type="button"
      variant="ghost"
      onClick={() => navigate(job.route)}
    >
      {job.kind === 'import' ? <JobIcon kind={job.kind}/> : <LoaderCircle aria-hidden="true" className="animate-spin text-accent" size={14}/>}
      <span className="hidden sm:inline">{kindLabel(job)}</span>
      {job.kind === 'import' ? <Progress inline value={job.progress} className="inline-block h-1 w-8 sm:w-12" aria-label="数据集导入进度"/>
        : <span className="size-1.5 rounded-full bg-accent sm:hidden" aria-hidden="true"/>}
    </Button>
  }
  const activeImport = jobs.find(job => job.kind === 'import')
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-label={`${jobs.length} 个任务进行中`} className="gap-1.5" size="sm" type="button" variant="ghost">
        <Activity aria-hidden="true" className="text-accent" size={15}/>
        <span className="hidden sm:inline">进行中</span>
        {activeImport ? <Progress inline value={activeImport.progress} className="inline-block h-1 w-8 sm:w-12" aria-label="数据集导入进度"/> : null}
        <span className="rounded-full bg-accent-soft px-1.5 text-[11px] tabular-nums text-accent">{jobs.length}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[min(92vw,300px)]">
      <DropdownMenuLabel className="text-xs text-foreground-3">正在运行</DropdownMenuLabel>
      {jobs.map(job => <DropdownMenuItem key={job.id} className="items-start gap-2 py-2" onSelect={() => navigate(job.route)}>
        <span className="mt-0.5 text-accent"><JobIcon kind={job.kind}/></span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm text-foreground">{job.label}</span>
          <span className="truncate text-[11px] text-foreground-3">{job.detail}</span>
          {job.kind === 'import' ? <Progress inline value={job.progress} className="mt-1 h-1" aria-label="数据集导入进度"/> : null}
        </span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
