import { Skeleton } from '@/components/ui/skeleton'

export function CardListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="grid gap-2" role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="grid gap-2 rounded-lg border border-border-soft bg-card p-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-4 w-56 max-w-[60%]"/>
        <Skeleton className="h-3 w-40 max-w-[35%]"/>
      </div>
      <Skeleton className="h-3 w-2/3 max-w-[520px]"/>
      <div className="flex flex-wrap gap-2"><Skeleton className="h-5 w-16"/><Skeleton className="h-5 w-16"/><Skeleton className="h-5 w-24"/></div>
      <Skeleton className="h-3 w-1/2 max-w-[360px]"/>
    </div>)}
  </div>
}

export function MasterDetailSkeleton({ label }: { label: string }) {
  return <div className="grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)] xl:grid-cols-[330px_minmax(0,1fr)]" role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">{label}</span>
    <div className="overflow-hidden rounded-xl border border-border-soft bg-card p-2">
      <Skeleton className="h-9 w-full"/>
      <Skeleton className="mt-2 h-8 w-full"/>
      <div className="mt-3 grid gap-2">
        {[0, 1, 2, 3, 4].map(index => <div key={index} className="grid gap-1.5 rounded-lg p-2">
          <div className="flex justify-between gap-2"><Skeleton className="h-4 w-2/3"/><Skeleton className="h-3 w-12"/></div>
          <Skeleton className="h-3 w-4/5"/>
          <Skeleton className="h-3 w-1/2"/>
        </div>)}
      </div>
    </div>
    <div className="grid content-start gap-3">
      <div className="overflow-hidden rounded-xl border border-border-soft bg-card p-5">
        <div className="flex items-start justify-between gap-4"><div className="grid flex-1 gap-2"><Skeleton className="h-6 w-3/5"/><Skeleton className="h-3 w-4/5"/><div className="flex gap-2"><Skeleton className="h-6 w-20"/><Skeleton className="h-6 w-20"/></div></div><Skeleton className="h-9 w-28"/></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="grid gap-1"><Skeleton className="h-3 w-16"/><Skeleton className="h-6 w-20"/></div>)}</div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map(index => <div key={index} className="rounded-xl border border-border-soft bg-card p-5">
          <Skeleton className="h-4 w-28"/>
          <div className="mt-4 grid gap-3">
            <Skeleton className="h-3 w-4/5"/>
            <Skeleton className="h-3 w-2/3"/>
            <Skeleton className="h-3 w-1/2"/>
            <Skeleton className="h-16 w-full"/>
          </div>
        </div>)}
      </div>
    </div>
  </div>
}

export function ProjectPageSkeleton({ label = '正在读取项目' }: { label?: string }) {
  return <section className="grid gap-4" role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">{label}</span>
    <div className="overflow-hidden rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]">
      <Skeleton className="h-4 w-24"/>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-2">
          <div className="flex flex-wrap items-center gap-3"><Skeleton className="h-7 w-48 max-w-[60vw]"/><Skeleton className="h-5 w-20 rounded-full"/></div>
          <div className="flex flex-wrap gap-2"><Skeleton className="h-3 w-40"/><Skeleton className="h-3 w-32"/><Skeleton className="h-3 w-24"/></div>
        </div>
        <div className="flex gap-2"><Skeleton className="h-9 w-24"/><Skeleton className="h-9 w-28"/><Skeleton className="h-9 w-24"/></div>
      </div>
    </div>
    <div className="flex gap-1 rounded-xl border border-border-soft bg-card p-1 shadow-[var(--sh-1)]"><Skeleton className="h-8 w-20"/><Skeleton className="h-8 w-20"/><Skeleton className="h-8 w-24"/></div>
    <div className="grid grid-cols-2 divide-x divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card shadow-[var(--sh-2)] sm:grid-cols-5 sm:divide-y-0">
      {[0, 1, 2, 3, 4].map(index => <div key={index} className="grid gap-2 px-4 py-4"><Skeleton className="h-6 w-20"/><Skeleton className="h-3 w-16"/></div>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="grid gap-3 rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]"><div className="flex justify-between"><Skeleton className="h-5 w-28"/><Skeleton className="h-3 w-20"/></div><Skeleton className="h-56 w-full"/><Skeleton className="h-3 w-40"/></div>
      <div className="grid gap-3 rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]"><Skeleton className="h-5 w-24"/><div className="flex items-center gap-4"><Skeleton className="size-28 rounded-full"/><div className="grid flex-1 gap-2"><Skeleton className="h-3 w-full"/><Skeleton className="h-3 w-4/5"/><Skeleton className="h-3 w-3/4"/></div></div></div>
    </div>
    <div className="grid gap-3 rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]"><Skeleton className="h-5 w-24"/> {[0, 1, 2].map(index => <div key={index} className="flex items-center justify-between gap-4 border-t border-border-soft pt-3"><Skeleton className="h-4 w-2/3"/><Skeleton className="h-3 w-24"/></div>)}</div>
  </section>
}

export function RepositoryOverviewSkeleton() {
  return <section className="grid gap-4" role="status" aria-busy="true" aria-live="polite">
    <span className="sr-only">正在读取仓库概览</span>
    <div className="flex items-center justify-between gap-4"><div className="grid gap-2"><Skeleton className="h-4 w-2/3"/><Skeleton className="h-3 w-1/2"/></div><Skeleton className="h-8 w-20"/></div>
    <div className="grid grid-cols-2 divide-x divide-y divide-border-soft overflow-hidden rounded-2xl border border-border-soft bg-card shadow-[var(--sh-2)] sm:grid-cols-5 sm:divide-y-0">
      {[0, 1, 2, 3, 4].map(index => <div key={index} className="grid gap-2 px-4 py-4"><Skeleton className="h-6 w-20"/><Skeleton className="h-3 w-16"/></div>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="grid gap-3 rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]"><Skeleton className="h-5 w-28"/><Skeleton className="h-56 w-full"/><Skeleton className="h-3 w-40"/></div>
      <div className="grid gap-3 rounded-2xl border border-border-soft bg-card p-5 shadow-[var(--sh-2)]"><Skeleton className="h-5 w-24"/><div className="flex items-center gap-4"><Skeleton className="size-28 rounded-full"/><div className="grid flex-1 gap-2"><Skeleton className="h-3 w-full"/><Skeleton className="h-3 w-4/5"/><Skeleton className="h-3 w-3/4"/></div></div></div>
    </div>
  </section>
}
