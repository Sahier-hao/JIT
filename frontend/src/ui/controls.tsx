/**
 * 工作区的控件层。
 *
 * 行为交给 Radix（焦点、键盘、无障碍语义），外观完全由 ui.css 用设计变量控制：
 * 同一个按钮在四个主题里都只用一层表面、一条细边，不叠阴影和渐变。
 */
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as Collapsible from '@radix-ui/react-collapsible'
import * as SelectPrimitive from '@radix-ui/react-select'
import clsx from 'clsx'
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useState } from 'react'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
  block?: boolean
  danger?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, trailing, loading, block, danger, className, children, disabled, ...rest }: ButtonProps) {
  return <button
    {...rest}
    disabled={disabled || loading}
    className={clsx('ui-btn', `ui-btn--${danger && variant === 'secondary' ? 'danger' : variant}`, `ui-btn--${size}`, block && 'ui-btn--block', className)}
  >
    {loading ? <Loader2 className="ui-btn-spin" size={14} aria-hidden/> : icon}
    {children ? <span>{children}</span> : null}
    {trailing}
  </button>
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx('ui-input', className)}/>
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx('ui-input ui-textarea', className)}/>
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...rest} className={clsx('ui-input ui-number', className)}/>
}

export interface Choice { value: string | number; label: string; disabled?: boolean }

export function Select({ value, onChange, options, placeholder = '请选择', ariaLabel, className, disabled }: {
  value?: string | number
  onChange: (value: string) => void
  options: Choice[]
  placeholder?: string
  ariaLabel: string
  className?: string
  disabled?: boolean
}) {
  const current = options.find(option => String(option.value) === String(value ?? ''))
  return <SelectPrimitive.Root value={value === undefined || value === null ? undefined : String(value)} onValueChange={onChange} disabled={disabled}>
    <SelectPrimitive.Trigger className={clsx('ui-select', className)} aria-label={ariaLabel}>
      <SelectPrimitive.Value placeholder={<span className="ui-select-placeholder">{placeholder}</span>}>{current?.label}</SelectPrimitive.Value>
      <SelectPrimitive.Icon className="ui-select-caret"><ChevronDown size={14}/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={4}>
        <SelectPrimitive.Viewport className="ui-select-viewport">
          {options.map(option => <SelectPrimitive.Item key={option.value} value={String(option.value)} disabled={option.disabled} className="ui-select-item">
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="ui-select-check"><Check size={13}/></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}

export function Checkbox({ checked, onCheckedChange, children, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
  ariaLabel?: string
  disabled?: boolean
}) {
  return <label className={clsx('ui-check', disabled && 'is-disabled')}>
    <CheckboxPrimitive.Root className="ui-check-box" checked={checked} disabled={disabled} onCheckedChange={value => onCheckedChange(value === true)} aria-label={ariaLabel}>
      <CheckboxPrimitive.Indicator className="ui-check-mark"><Check size={11} strokeWidth={3}/></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
    {children ? <span className="ui-check-label">{children}</span> : null}
  </label>
}

export function Disclosure({ summary, children, className, trailing }: { summary: ReactNode; children: ReactNode; className?: string; trailing?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Collapsible.Root open={open} onOpenChange={setOpen} className={clsx('ui-disclosure', className)}>
    <div className="ui-disclosure-head">
      <Collapsible.Trigger className="ui-disclosure-trigger">
        <ChevronRight size={13} className={clsx('ui-disclosure-caret', open && 'is-open')} aria-hidden/>
        {summary}
      </Collapsible.Trigger>
      {trailing}
    </div>
    <Collapsible.Content className="ui-disclosure-content">{children}</Collapsible.Content>
  </Collapsible.Root>
}

export function InlineAlert({ tone = 'alert', title, children, action }: { tone?: 'alert' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div className={clsx('ui-alert', `ui-alert--${tone}`)} role="alert">
    <div className="ui-alert-body"><p className="ui-alert-title">{title}</p>{children ? <div className="ui-alert-text">{children}</div> : null}</div>
    {action}
  </div>
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return <SwitchPrimitive.Root className="ui-switch" checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={ariaLabel}>
    <SwitchPrimitive.Thumb className="ui-switch-thumb"/>
  </SwitchPrimitive.Root>
}

/** 图标按钮：用于记录行的紧凑动作，必须带可访问名称。 */
export const IconButton = forwardRef<HTMLButtonElement, { label: string; icon: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; className?: string }>(function IconButton({ label, icon, disabled, danger, className, ...rest }, ref) {
  return <button
    ref={ref}
    type="button"
    className={clsx('ui-iconbtn', danger && 'ui-iconbtn--danger', className)}
    aria-label={label}
    title={label}
    disabled={disabled}
    {...rest}
  >{icon}</button>
})