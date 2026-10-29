/**
 * 工作区控件层。
 *
 * 行为交给 Radix（焦点、键盘、无障碍语义），外观由 Tailwind 语义令牌控制：
 * 颜色全部来自 index.css 的 @theme → tokens.css，不写死色值，四套主题自动跟随。
 */
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as Collapsible from '@radix-ui/react-collapsible'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ChangeEvent, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'

const buttonVariants: Record<Variant, string> = {
  primary: 'border-primary bg-primary text-primary-foreground hover:bg-[var(--btn-hover)]',
  accent: 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
  secondary: 'border-input bg-card text-foreground hover:bg-[var(--hover)]',
  ghost: 'border-transparent bg-transparent text-[var(--fg-2)] hover:bg-[var(--hover)] hover:text-foreground',
  danger: 'border-[var(--risk-high)] bg-[var(--risk-high)] text-white hover:opacity-90',
  link: 'h-auto border-transparent bg-transparent px-0 text-[var(--accent)] hover:underline underline-offset-4',
}

const buttonSizes: Record<Size, string> = {
  sm: 'h-[26px] px-2 text-xs',
  md: 'h-[30px] px-3 text-[13px]',
  lg: 'h-9 px-4 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
  block?: boolean
  danger?: boolean
  href?: string
  target?: string
  rel?: string
}

export function Button({ variant = 'secondary', size = 'md', type = 'button', icon, trailing, loading, block, danger, className, children, disabled, href, target, rel, ...rest }: ButtonProps) {
  const resolved = danger && variant === 'secondary' ? 'danger' : variant
  const classes = cn(
    'ui-btn', `ui-btn--${resolved}`, `ui-btn--${size}`,
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium leading-none transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    buttonVariants[resolved],
    buttonSizes[size],
    block && 'w-full',
    className,
  )
  const content = <>{loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden/> : icon}{children ? <span>{children}</span> : null}{trailing}</>
  if (href) {
    return <a {...(rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)} href={href} target={target} rel={rel} className={classes}>{content}</a>
  }
  return <button
    {...rest}
    type={type}
    disabled={disabled || loading}
    className={classes}
  >{content}</button>
}

const fieldBase = 'w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors ' +
  'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export function Input({ prefix, allowClear, size, className, value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & {
  prefix?: ReactNode
  allowClear?: boolean
  size?: 'sm' | 'md'
}) {
  const input = <input
    {...rest}
    value={value}
    onChange={onChange}
    className={cn('ui-input', fieldBase, size === 'sm' ? 'h-[26px] text-xs' : 'h-[30px]',
      prefix && 'pl-8', allowClear && value ? 'pr-8' : '', className)}
  />
  if (!prefix && !allowClear) return input
  return <span className="relative flex w-full items-center">
    {prefix ? <span className="pointer-events-none absolute left-2 flex items-center text-muted-foreground">{prefix}</span> : null}
    {input}
    {allowClear && value ? <button
      type="button"
      aria-label="清除"
      onClick={() => onChange?.({ target: { value: '' } } as unknown as ChangeEvent<HTMLInputElement>)}
      className="absolute right-1.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground"
    ><X size={13}/></button> : null}
  </span>
}

export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="password" {...rest} className={cn('ui-input', fieldBase, 'h-[30px]', className)}/>
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn('ui-input ui-textarea', fieldBase, 'min-h-20 py-2 leading-relaxed', className)}/>
}

export function NumberInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="number" {...rest} className={cn('ui-input ui-number', fieldBase, 'h-[30px] tabular-nums', className)}/>
}

export interface Choice { value: string | number; label: string; disabled?: boolean }

export function Select({ value, onChange, options, placeholder = '请选择', ariaLabel, 'aria-label': ariaLabelProp, className, style, size = 'md', disabled }: {
  value?: string | number
  onChange: (value: string) => void
  options: Choice[]
  placeholder?: string
  ariaLabel?: string
  'aria-label'?: string
  className?: string
  style?: CSSProperties
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  const current = options.find(option => String(option.value) === String(value ?? ''))
  return <SelectPrimitive.Root value={value === undefined || value === null ? undefined : String(value)} onValueChange={onChange} disabled={disabled}>
    <SelectPrimitive.Trigger
      aria-label={ariaLabel ?? ariaLabelProp}
      style={style}
      className={cn('ui-select inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground',
        size === 'sm' ? 'h-[26px] text-xs' : 'h-[30px]',
        'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 data-[placeholder]:text-muted-foreground', className)}
    >
      <SelectPrimitive.Value placeholder={<span className="text-muted-foreground">{placeholder}</span>}>{current?.label}</SelectPrimitive.Value>
      <SelectPrimitive.Icon className="text-muted-foreground"><ChevronDown size={14}/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-[70] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[var(--sh-2)]"
      >
        <SelectPrimitive.Viewport>
          {options.map(option => <SelectPrimitive.Item
            key={option.value}
            value={String(option.value)}
            disabled={option.disabled}
            className="relative flex cursor-default select-none items-center rounded px-2 py-1.5 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--hover)]"
          >
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="absolute right-2 text-[var(--accent)]"><Check size={13}/></SelectPrimitive.ItemIndicator>
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
  return <label className={cn('inline-flex cursor-pointer items-start gap-2 text-[13px]', disabled && 'cursor-not-allowed opacity-50')}>
    <CheckboxPrimitive.Root
      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-input bg-card text-white data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      checked={checked}
      disabled={disabled}
      onCheckedChange={value => onCheckedChange(value === true)}
      aria-label={ariaLabel}
    >
      <CheckboxPrimitive.Indicator><Check size={11} strokeWidth={3}/></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
    {children ? <span className="leading-snug">{children}</span> : null}
  </label>
}

export function Disclosure({ summary, children, className, trailing }: { summary: ReactNode; children: ReactNode; className?: string; trailing?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Collapsible.Root open={open} onOpenChange={setOpen} className={cn('ui-disclosure rounded-lg border border-border bg-card', className)}>
    <div className="flex items-center gap-2 px-3.5 py-2.5">
      <Collapsible.Trigger className="ui-disclosure-trigger inline-flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight size={13} className={cn('ui-disclosure-caret shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden/>
        {summary}
      </Collapsible.Trigger>
      {trailing}
    </div>
    <Collapsible.Content className="ui-disclosure-content border-t border-border px-3.5 py-3 text-[13px]">{children}</Collapsible.Content>
  </Collapsible.Root>
}

export function InlineAlert({ tone = 'alert', title, children, action }: { tone?: 'alert' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <div
    role="alert"
    className={cn(`ui-alert ui-alert--${tone}`, 'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[13px]',
      tone === 'alert'
        ? 'border-[color-mix(in_oklab,var(--risk-high)_35%,transparent)] bg-[var(--risk-soft)] text-[var(--risk-fg)]'
        : 'border-[color-mix(in_oklab,var(--accent)_28%,transparent)] bg-[var(--accent-soft)] text-[var(--fg)]')}
  >
    <div className="min-w-0 flex-1"><p className="m-0 font-semibold">{title}</p>{children ? <div className="mt-1 text-[var(--fg-2)]">{children}</div> : null}</div>
    {action}
  </div>
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return <SwitchPrimitive.Root
    className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-[var(--line-strong)] transition-colors data-[state=checked]:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    checked={checked}
    disabled={disabled}
    onCheckedChange={onCheckedChange}
    aria-label={ariaLabel}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5"/>
  </SwitchPrimitive.Root>
}

/** 图标按钮：用于记录行的紧凑动作，必须带可访问名称。 */
export const IconButton = forwardRef<HTMLButtonElement, { label: string; icon: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; className?: string }>(function IconButton({ label, icon, disabled, danger, className, ...rest }, ref) {
  return <button
    ref={ref}
    type="button"
    className={cn('inline-flex size-8 items-center justify-center rounded-md text-[var(--fg-3)] transition-colors',
      'hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      danger && 'hover:bg-[var(--risk-soft)] hover:text-[var(--risk-high)]',
      'disabled:pointer-events-none disabled:opacity-50', className)}
    aria-label={label}
    title={label}
    disabled={disabled}
    {...rest}
  >{icon}</button>
})
