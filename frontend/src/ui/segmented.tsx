import { SegmentedControl as MantineSegmentedControl } from '@mantine/core'
import clsx from 'clsx'

/** 分段控件：由 Mantine SegmentedControl 渲染，保持原有 value/onChange 语义。 */
export function Segmented<T extends string | number>({ value, onChange, options, ariaLabel, 'aria-label': ariaLabelProp, size = 'md', className }: {
  value: T
  onChange: (value: T) => void
  options: { label: string; value: T; disabled?: boolean }[]
  ariaLabel?: string
  'aria-label'?: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return <MantineSegmentedControl
    data={options.map(option => ({ label: option.label, value: String(option.value), disabled: option.disabled }))}
    value={String(value)}
    onChange={next => { const found = options.find(option => String(option.value) === next); if (found) onChange(found.value) }}
    size={size === 'sm' ? 'xs' : 'sm'}
    aria-label={ariaLabel ?? ariaLabelProp}
    className={clsx('ui-segmented', className)}
  />
}
