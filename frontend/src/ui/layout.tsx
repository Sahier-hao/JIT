/**
 * 共享表面与结构：页面标题、区块标题、卡片、表格与进度。
 *
 * 这些形状是跨页面一致性的落点：表头、行高、卡片内边距与页面标题都由这里决定，
 * 密度切换读取 `tokens.css` 的 `--sp-*` 变量，页面不再各自复制结构。
 */
import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../lib/utils'

export function PageHeader({ eyebrow, title, description, actions, className }: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return <header className={cn('flex flex-wrap items-end justify-between gap-3 border-b border-border-soft pb-3', className)}>
    <div className="min-w-0">
      {eyebrow ? <p className="text-xs text-foreground-3">{eyebrow}</p> : null}
      <h1 className="font-sans text-xl font-semibold leading-title text-foreground">{title}</h1>
      {description ? <p className="mt-1 text-sm text-foreground-2">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </header>
}

export function SectionHeader({ title, aside, actions, className }: {
  title: ReactNode
  aside?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return <div className={cn('flex flex-wrap items-center justify-between gap-2 pb-2', className)}>
    <h2 className="text-lg font-semibold leading-title text-foreground">{title}</h2>
    {aside ?? actions}
  </div>
}

export function TabBar<T extends string>({ value, onChange, items, label, className }: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: ReactNode }[]
  label: string
  className?: string
}) {
  return <nav aria-label={label} className={cn('flex gap-1 border-b border-border', className)}>
    {items.map(item => <button
      key={item.value}
      type="button"
      aria-current={value === item.value ? 'page' : undefined}
      onClick={() => onChange(item.value)}
      className={cn(
        'border-0 border-b-2 bg-transparent px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        value === item.value ? 'border-accent font-medium text-foreground' : 'border-transparent text-foreground-3 hover:text-foreground',
      )}
    >{item.label}</button>)}
  </nav>
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-md border border-border-soft bg-card p-card', className)}>{children}</section>
}

export function CardHeader({ title, description, actions, className }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return <div className={cn('flex items-start justify-between gap-3 pb-2', className)}>
    <div className="min-w-0">
      <h3 className="text-base font-semibold leading-title text-foreground">{title}</h3>
      {description ? <p className="mt-0.5 text-xs text-foreground-3">{description}</p> : null}
    </div>
    {actions}
  </div>
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-sm text-foreground-2', className)}>{children}</div>
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border-soft pt-3', className)}>{children}</div>
}

export function Table({ children, className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto rounded-md border border-border-soft">
    <table {...rest} className={cn('w-full border-collapse text-sm text-foreground-2', className)}>{children}</table>
  </div>
}

export function TableHead({ children, className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...rest} className={cn('bg-sunken', className)}>{children}</thead>
}

export function TableBody({ children, className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...rest} className={className}>{children}</tbody>
}

export function TableRow({ children, className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...rest} className={cn('h-row border-b border-border-soft transition-colors last:border-0 hover:bg-hover', className)}>{children}</tr>
}

export function TableHeaderCell({ children, numeric, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th {...rest} scope="col" className={cn('px-cell-x py-cell-y text-left text-xs font-medium text-foreground-3', numeric && 'text-right tabular-nums', className)}>{children}</th>
}

export function TableCell({ children, numeric, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td {...rest} className={cn('px-cell-x py-cell-y align-middle', numeric && 'text-right tabular-nums', className)}>{children}</td>
}

export function Progress({ value, max = 100, label, className }: {
  value: number
  max?: number
  label?: string
  className?: string
}) {
  const percent = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))
  return <div
    role="progressbar"
    aria-label={label}
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={max}
    className={cn('h-1.5 w-full overflow-hidden rounded-full bg-strong', className)}
  >
    <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }}/>
  </div>
}
