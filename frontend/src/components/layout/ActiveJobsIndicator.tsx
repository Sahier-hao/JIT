import { Activity, Database, LoaderCircle, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Route } from '@/app/navigation'

export interface ActiveJob {
  id: string
  kind: 'collection' | 'training'
  label: string
  detail: string
  route: Route
}

function kindLabel(job: ActiveJob) {
  return job.kind === 'collection' ? '采集中' : '训练中'
}

function kindName(job: ActiveJob) {
  return job.kind === 'collection' ? '采集任务' : '训练任务'
}

function JobIcon({ kind }: { kind: ActiveJob['kind'] }) {
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
      <LoaderCircle aria-hidden="true" className="animate-spin text-accent" size={14}/>
      <span className="hidden sm:inline">{kindLabel(job)}</span>
      <span className="size-1.5 rounded-full bg-accent sm:hidden" aria-hidden="true"/>
    </Button>
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-label={`${jobs.length} 个任务进行中`} className="gap-1.5" size="sm" type="button" variant="ghost">
        <Activity aria-hidden="true" className="text-accent" size={15}/>
        <span className="hidden sm:inline">进行中</span>
        <span className="rounded-full bg-accent-soft px-1.5 text-[11px] tabular-nums text-accent">{jobs.length}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-[min(92vw,300px)]">
      <DropdownMenuLabel className="text-xs text-foreground-3">正在运行</DropdownMenuLabel>
      {jobs.map(job => <DropdownMenuItem key={job.id} className="items-start gap-2 py-2" onSelect={() => navigate(job.route)}>
        <span className="mt-0.5 text-accent"><JobIcon kind={job.kind}/></span>
        <span className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm text-foreground">{job.label}</span>
          <span className="truncate text-[11px] text-foreground-3">{job.detail}</span>
        </span>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
