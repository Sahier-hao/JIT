import type { ReactNode } from 'react'

export function WorkspacePageHeader({ title, meta, actions }: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}) {
  return <header className="flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-3 border-b border-border-soft pb-4">
    <div className="min-w-0 flex-[1_1_13rem] [overflow-wrap:anywhere]">
      <h1 className="font-sans text-xl font-semibold leading-title tracking-tight text-foreground sm:text-2xl">{title}</h1>
      {meta == null ? null : <div className="mt-1 text-sm leading-snug text-foreground-3">{meta}</div>}
    </div>
    {actions == null ? null : <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
}
