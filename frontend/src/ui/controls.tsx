/**
 * 控件层：Radix 行为 + CVA 变体 + Tailwind 工具类的共享组件。
 *
 * 页面只使用这里的导出，不直接拼控件样式。颜色、圆角与间距全部来自
 * `styles/tokens.css` 的主题映射，四套主题与两档密度切换时无需重建组件。
 */
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ButtonHTMLAttributes, ChangeEvent, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useState } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Icon } from '../Icon'
import { cn } from '../lib/utils'

type Size = 'sm' | 'md' | 'lg'

/* ------------------------------------------------------------------ Button */

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-primary text-primary-foreground hover:bg-primary-hover',
        accent: 'border-transparent bg-accent text-foreground-inverse hover:bg-accent-hover',
        secondary: 'border-border-strong bg-card text-foreground hover:bg-hover',
        ghost: 'border-transparent bg-transparent text-foreground-2 hover:bg-hover hover:text-foreground',
        danger: 'border-transparent bg-risk-high text-foreground-inverse hover:opacity-90',
        link: 'border-transparent bg-transparent px-0 text-accent hover:text-accent-hover hover:underline underline-offset-2',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3 text-sm',
        lg: 'h-10 px-4 text-base',
      },
    },
    compoundVariants: [{ variant: 'link', class: 'h-auto' }],
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
  block?: boolean
  danger?: boolean
  href?: string
  target?: string
  rel?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', type = 'button', icon, trailing, loading, block, danger, className, children, disabled, href, target, rel, ...rest },
  ref,
) {
  const resolved = danger && variant === 'secondary' ? 'danger' : variant
  const classes = cn(buttonVariants({ variant: resolved, size }), block && 'w-full', className)
  const content = <>
    {loading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden/> : icon}
    {children}
    {trailing}
  </>
  if (href) {
    return <a href={href} target={target} rel={rel} className={classes} title={rest.title} aria-label={rest['aria-label']}>{content}</a>
  }
  return <button ref={ref} type={type} className={classes} disabled={disabled || loading} {...rest}>{content}</button>
})

/** 图标按钮：用于记录行的紧凑动作，必须带可访问名称。 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & { label: string; icon: ReactNode; danger?: boolean }>(function IconButton({ label, icon, danger, className, ...rest }, ref) {
  return <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      'inline-grid size-8 place-items-center rounded-sm border border-transparent text-foreground-3 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
      danger && 'text-rose hover:bg-rose-soft hover:text-rose-deep',
      className,
    )}
    {...rest}
  >{icon}</button>
})

/* ------------------------------------------------------------------- Input */

const inputClasses = 'w-full rounded-sm border border-input bg-card px-3 text-foreground placeholder:text-foreground-4 transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const inputSizes: Record<Size, string> = {
  sm: 'h-7 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-10 text-base',
}

export function Input({ prefix, allowClear, size = 'md', className, value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & {
  prefix?: ReactNode
  allowClear?: boolean
  size?: Size
}) {
  const field = <input
    {...rest}
    value={value}
    onChange={onChange}
    className={cn(inputClasses, inputSizes[size], prefix && 'pl-9', allowClear && value && 'pr-9', className)}
  />
  if (!prefix && !allowClear) return field
  return <div className="relative">
    {prefix ? <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-4">{prefix}</span> : null}
    {field}
    {allowClear && value ? <button
      type="button"
      aria-label="清除"
      className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm border-0 bg-transparent text-foreground-4 hover:bg-hover hover:text-foreground"
      onClick={() => onChange?.({ target: { value: '' } } as unknown as ChangeEvent<HTMLInputElement>)}
    ><Icon name="close" size={13}/></button> : null}
  </div>
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea
    {...rest}
    rows={rest.rows ?? 3}
    className={cn('min-h-[72px] w-full rounded-sm border border-input bg-card p-2.5 text-sm text-foreground placeholder:text-foreground-4 transition-colors focus:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)}
  />
}

export function NumberInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>) {
  return <input {...rest} type="number" className={cn(inputClasses, className)}/>
}

export function PasswordInput({ className, value, onChange, placeholder, disabled, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>) {
  const [visible, setVisible] = useState(false)
  return <div className="relative">
    <input
      {...rest}
      type={visible ? 'text' : 'password'}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(inputClasses, 'pr-9', className)}
    />
    <button
      type="button"
      aria-label={visible ? '隐藏密码' : '显示密码'}
      className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm border-0 bg-transparent text-foreground-4 hover:bg-hover hover:text-foreground"
      onClick={() => setVisible(current => !current)}
    ><Icon name={visible ? 'eyeOff' : 'eye'} size={15}/></button>
  </div>
}

/* ------------------------------------------------------------------ Select */

export interface Choice { value: string | number; label: string; disabled?: boolean }

export function Select({ value, onChange, options, placeholder = '请选择', ariaLabel, 'aria-label': ariaLabelProp, className, style, disabled }: {
  value?: string | number
  onChange: (value: string) => void
  options: Choice[]
  placeholder?: string
  ariaLabel?: string
  'aria-label'?: string
  className?: string
  style?: CSSProperties
  size?: Size
  disabled?: boolean
}) {
  return <SelectPrimitive.Root
    value={value === undefined || value === null ? undefined : String(value)}
    onValueChange={onChange}
    disabled={disabled}
  >
    <SelectPrimitive.Trigger
      aria-label={ariaLabel ?? ariaLabelProp}
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-input bg-card px-3 text-left text-sm text-foreground transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-[placeholder]:text-foreground-4 disabled:opacity-50',
        className,
      )}
      style={style}
    >
      <SelectPrimitive.Value placeholder={placeholder}/>
      <SelectPrimitive.Icon><Icon name="chevron" size={13} className="rotate-90 text-foreground-4"/></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-[400] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-md border border-border-soft bg-popover p-1 text-popover-foreground shadow-2"
      >
        <SelectPrimitive.Viewport>
          {options.map(option => <SelectPrimitive.Item
            key={String(option.value)}
            value={String(option.value)}
            disabled={option.disabled}
            className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-hover data-[disabled]:opacity-50"
          >
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="ml-auto"><Icon name="check" size={13}/></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}

/* ------------------------------------------------------- Checkbox / Switch */

export function Checkbox({ checked, onCheckedChange, children, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
  ariaLabel?: string
  disabled?: boolean
}) {
  return <label className="inline-flex cursor-pointer items-start gap-2 text-sm text-foreground">
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={value => onCheckedChange(value === true)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border border-border-strong bg-card transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <CheckboxPrimitive.Indicator className="text-foreground-inverse"><Icon name="check" size={11}/></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
    {children ? <span className="leading-5">{children}</span> : null}
  </label>
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return <SwitchPrimitive.Root
    checked={checked}
    onCheckedChange={onCheckedChange}
    disabled={disabled}
    aria-label={ariaLabel}
    className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-card shadow-1 transition-transform data-[state=checked]:translate-x-[18px]"/>
  </SwitchPrimitive.Root>
}

/* -------------------------------------------------------------- Disclosure */

export function Disclosure({ summary, children, className, trailing }: { summary: ReactNode; children: ReactNode; className?: string; trailing?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} className={cn('rounded-sm', className)}>
    <div className="flex items-center gap-2">
      <CollapsiblePrimitive.Trigger className="inline-flex flex-1 items-center gap-1.5 rounded-sm py-1 text-left text-sm text-foreground-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <Icon name="chevron" size={13} className={cn('text-foreground-4 transition-transform', open && 'rotate-90')}/>
        {summary}
      </CollapsiblePrimitive.Trigger>
      {trailing}
    </div>
    <CollapsiblePrimitive.Content className="pt-2">{children}</CollapsiblePrimitive.Content>
  </CollapsiblePrimitive.Root>
}

/* ------------------------------------------------------------------- Alert */

export function InlineAlert({ tone = 'alert', title, children, action }: { tone?: 'alert' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const alert = tone === 'alert'
  return <div
    role={alert ? 'alert' : 'note'}
    className={cn(
      'flex gap-2 rounded-sm border p-3 text-sm',
      alert ? 'border-risk-high/40 bg-risk-soft text-risk-foreground' : 'border-blue/30 bg-blue-soft text-blue-deep',
    )}
  >
    <Icon name={alert ? 'warning' : 'info'} size={16} className="mt-0.5 shrink-0"/>
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5">{children}</div> : null}
      </div>
      {action}
    </div>
  </div>
}
