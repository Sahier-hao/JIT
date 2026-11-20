import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function DatasetMetric({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return <div className="min-w-0 px-4 py-3">
    <dt className="text-[11px] font-medium tracking-wide text-foreground-4">{label}</dt>
    <dd className="m-0 mt-1 flex flex-wrap items-baseline gap-2">
      <strong className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</strong>
      {note ? <span className="text-[11px] text-foreground-3">{note}</span> : null}
    </dd>
  </div>
}

export function DatasetFact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={cn('min-w-0', className)}>
    <dt className="text-[11px] font-medium tracking-wide text-foreground-4">{label}</dt>
    <dd className="m-0 mt-1 min-w-0 break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{children}</dd>
  </div>
}

export function DatasetSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card p-5 shadow-sm">
    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon aria-hidden="true" className="text-accent" size={16} strokeWidth={1.6}/>{title}
    </h2>
    <div className="mt-4">{children}</div>
  </section>
}
