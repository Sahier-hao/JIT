import { Search } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { Input } from '@/components/ui/input'

export const catalogRowClass = 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-transparent px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-accent aria-[current=page]:border-border-soft aria-[current=page]:bg-sunken hover:bg-hover'

export function CatalogSearch({ label, placeholder, value, onChange }: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return <div className="relative">
    <Search aria-hidden="true" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-4"/>
    <Input className="h-8 pl-8 text-xs" aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}/>
  </div>
}

export function AdminCatalogLayout({ directoryLabel, listLabel, detailLabel, filters, list, detail, detailRef }: {
  directoryLabel: string
  listLabel: string
  detailLabel: string
  filters: ReactNode
  list: ReactNode
  detail: ReactNode
  detailRef?: Ref<HTMLDivElement>
}) {
  return <div className="grid min-h-0 min-w-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)]">
    <aside aria-label={directoryLabel} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border-soft bg-card shadow-sm">
      <div className="grid gap-2 border-b border-border-soft p-3">{filters}</div>
      <nav aria-label={listLabel} className="max-h-64 min-h-0 flex-1 overflow-auto overscroll-contain p-2 lg:max-h-none">{list}</nav>
    </aside>
    <div ref={detailRef} role="region" aria-label={detailLabel} tabIndex={0}
      className="grid min-h-0 min-w-0 auto-rows-max content-start gap-3 overflow-x-hidden focus-visible:outline-2 focus-visible:outline-accent lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]">
      {detail}
    </div>
  </div>
}
