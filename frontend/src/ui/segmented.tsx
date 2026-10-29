import { cn } from '@/lib/utils'

/** 分段控件：与 antd Segmented 的用法兼容，视觉走语义令牌。 */
export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, 'aria-label': ariaLabelProp, size = 'md', className }: {
  value: T
  onChange: (value: T) => void
  options: { label: string; value: T; disabled?: boolean }[]
  ariaLabel?: string
  'aria-label'?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return <div role="group" aria-label={ariaLabel ?? ariaLabelProp} className={cn('inline-flex items-center gap-0.5 rounded-md border border-border bg-[var(--sunken)] p-0.5', className)}>
    {options.map(option => <button
      key={String(option.value)}
      type="button"
      aria-pressed={option.value === value}
      disabled={option.disabled}
      onClick={() => onChange(option.value)}
      className={cn('rounded px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        size === 'sm' ? 'h-6 text-xs' : 'h-7 text-[13px]',
        option.value === value
          ? 'bg-card text-foreground shadow-[var(--sh-1)]'
          : 'text-[var(--fg-3)] hover:text-foreground')}
    >{option.label}</button>)}
  </div>
}
