import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { ReactNode } from 'react'


import { metricReason, metricValue, type Row } from '../../adminContracts'

export function AdminPageHeader({ title, meta, actions, onRefresh }: { title: string; meta?: ReactNode; actions?: ReactNode; onRefresh?: () => void }) {
  return <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-3">
    <div className="grid min-w-0 gap-1"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">{title}</h1>{meta ? <p className="text-xs text-foreground-3">{meta}</p> : null}</div>
    <div className="flex flex-wrap items-center gap-2">{actions}{onRefresh ? <Button onClick={onRefresh} variant="outline" type="button">刷新</Button> : null}</div>
  </header>
}

const METRICS = [
  ['averagePrecision', 'AP'],
  ['rocAuc', 'ROC-AUC'],
  ['recall20Loc', 'Recall@20%LOC'],
  ['popt', 'Popt'],
  ['f1', 'F1'],
  ['ifa', 'IFA'],
] as const

export function MetricGrid({ metrics }: { metrics: Row | null | undefined }) {
  if (!metrics) return <p className="text-xs text-foreground-3">尚无训练指标。</p>
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-soft bg-border-soft sm:grid-cols-3 lg:grid-cols-6">
    {METRICS.map(([key, name]) => {
      const value = metricValue(metrics, key)
      return <div key={key} className="grid gap-0.5 bg-card p-2.5"><span className="text-xs text-foreground-3">{name}</span><strong className="text-lg font-semibold tabular-nums text-foreground">{value === null ? '未定义' : value.toFixed(4)}</strong>{value === null && metricReason(metrics, key) ? <small className="text-[11px] text-foreground-4">{metricReason(metrics, key)}</small> : null}</div>
    })}
  </div>
}

export function MetricComparison({ left, right, leftName, rightName }: { left: Row; right: Row; leftName: string; rightName: string }) {
  return <Table><TableHeader><TableRow><TableHead>指标</TableHead><TableHead>{leftName}</TableHead><TableHead>{rightName}</TableHead></TableRow></TableHeader><TableBody>{METRICS.map(([key, name]) => <TableRow key={key}><TableCell className="font-medium text-foreground-2">{name}</TableCell><MetricCell metrics={left} metric={key}/><MetricCell metrics={right} metric={key}/></TableRow>)}</TableBody></Table>
}

function MetricCell({ metrics, metric }: { metrics: Row; metric: string }) {
  const value = metricValue(metrics, metric)
  const reason = metricReason(metrics, metric)
  return <TableCell>{value === null ? '未定义' : value.toFixed(4)}{value === null && reason ? <small className="block text-[11px] text-foreground-4">{reason}</small> : null}</TableCell>
}

export function ErrorNotice({ children }: { children: string }) {
  return children ? <p className="text-xs text-rose" role="alert">{children}</p> : null
}
