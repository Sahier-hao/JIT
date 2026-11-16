/**
 * 分段控件：单选按钮组。
 *
 * 语义是 radiogroup，保留原有 `value / onChange / options` API；
 * 选中态用表面与文字色区分，并保持可见焦点。
 */
import { cn } from '../lib/utils'

export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, 'aria-label': ariaLabelProp, size = 'md', className }: {
  value: T
  onChange: (value: T) => void
  options: { label: string; value: T; disabled?: boolean }[]
  ariaLabel?: string
  'aria-label'?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return <div
    role="radiogroup"
    aria-label={ariaLabel ?? ariaLabelProp}
    className={cn('inline-flex items-center gap-0.5 rounded-md border border-border-soft bg-sunken p-0.5', className)}
  >
    {options.map(option => {
      const selected = option.value === value
      return <button
        key={String(option.value)}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={option.disabled}
        onClick={() => onChange(option.value)}
        className={cn(
          'rounded-sm border-0 bg-transparent font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50',
          size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-xs',
          selected ? 'bg-card text-foreground shadow-1' : 'text-foreground-3 hover:text-foreground',
        )}
      >{option.label}</button>
    })}
  </div>
}
