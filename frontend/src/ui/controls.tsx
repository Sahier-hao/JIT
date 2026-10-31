/**
 * 控件层适配：全部由 Mantine 渲染，这里只负责把项目既有 API 映射到 Mantine 组件。
 *
 * 颜色、圆角与字体由 mantineTheme 和 mantine-bridge.css 指回设计令牌，
 * 四套主题切换时无需重建组件。
 */
import {
  ActionIcon,
  Alert as MantineAlert,
  Button as MantineButton,
  Checkbox as MantineCheckbox,
  CloseButton,
  Collapse,
  Select as MantineSelect,
  PasswordInput as MantinePasswordInput,
  Switch as MantineSwitch,
  Textarea as MantineTextarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import type { ButtonHTMLAttributes, ChangeEvent, CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { forwardRef, useState } from 'react'
import { ChevronRight, Info } from 'lucide-react'
import clsx from 'clsx'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'

const buttonVariants: Record<Variant, { variant: 'filled' | 'default' | 'subtle'; color?: string }> = {
  primary: { variant: 'filled' },
  accent: { variant: 'filled', color: 'accent' },
  secondary: { variant: 'default' },
  ghost: { variant: 'subtle' },
  danger: { variant: 'filled', color: 'red' },
  link: { variant: 'subtle', color: 'accent' },
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
  const config = buttonVariants[resolved]
  const common = {
    size,
    variant: config.variant,
    color: config.color,
    leftSection: icon,
    rightSection: trailing,
    loading,
    fullWidth: block,
    disabled,
    className: clsx('ui-btn', `ui-btn--${resolved}`, `ui-btn--${size}`, className),
  }
  if (href) {
    return <MantineButton component="a" href={href} target={target} rel={rel} {...common}>{children}</MantineButton>
  }
  return <MantineButton type={type} {...common} {...rest}>{children}</MantineButton>
}

export function Input({ prefix, allowClear, size = 'md', className, value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> & {
  prefix?: ReactNode
  allowClear?: boolean
  size?: Size
}) {
  return <TextInput
    {...rest}
    value={value}
    onChange={onChange}
    size={size}
    leftSection={prefix}
    rightSection={allowClear && value ? <CloseButton onClick={() => onChange?.({ target: { value: '' } } as unknown as ChangeEvent<HTMLInputElement>)} aria-label="清除"/> : undefined}
    className={clsx('ui-input', className)}
  />
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <MantineTextarea
    value={rest.value as string | undefined}
    onChange={rest.onChange as never}
    readOnly={rest.readOnly}
    disabled={rest.disabled}
    placeholder={rest.placeholder}
    aria-label={rest['aria-label']}
    rows={3}
    className={clsx('ui-input ui-textarea', className)}
  />
}

export function NumberInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>) {
  return <TextInput {...rest} type="number" className={clsx('ui-input ui-number', className)}/>
}

export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>) {
  return <MantinePasswordInput {...rest} className={clsx('ui-input', className)} visibilityToggleButtonProps={{ 'aria-label': '显示或隐藏密码' }}/>
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
  size?: Size
  disabled?: boolean
}) {
  return <MantineSelect
    data={options.map(option => ({ value: String(option.value), label: option.label, disabled: option.disabled }))}
    value={value === undefined || value === null ? null : String(value)}
    onChange={next => onChange(next ?? '')}
    placeholder={placeholder}
    disabled={disabled}
    size={size}
    style={style}
    className={clsx('ui-select', className)}
    aria-label={ariaLabel ?? ariaLabelProp}
    comboboxProps={{ withinPortal: true, zIndex: 400 }}
    allowDeselect={false}
  />
}

export function Checkbox({ checked, onCheckedChange, children, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children?: ReactNode
  ariaLabel?: string
  disabled?: boolean
}) {
  return <MantineCheckbox
    checked={checked}
    onChange={event => onCheckedChange(event.currentTarget.checked)}
    label={children}
    disabled={disabled}
    aria-label={ariaLabel}
    className="ui-check"
  />
}

export function Disclosure({ summary, children, className, trailing }: { summary: ReactNode; children: ReactNode; className?: string; trailing?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <div className={clsx('ui-disclosure', className)}>
    <div className="ui-disclosure-head">
      <UnstyledButton className="ui-disclosure-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <ChevronRight size={13} className={clsx('ui-disclosure-caret', open && 'is-open')} aria-hidden/>
        {summary}
      </UnstyledButton>
      {trailing}
    </div>
    <Collapse expanded={open}><div className="ui-disclosure-content">{children}</div></Collapse>
  </div>
}

export function InlineAlert({ tone = 'alert', title, children, action }: { tone?: 'alert' | 'info'; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return <MantineAlert
    color={tone === 'alert' ? 'red' : 'blue'}
    title={title}
    icon={<Info size={16}/>}
    className={clsx('ui-alert', `ui-alert--${tone}`)}
  >
    <div className="flex items-start justify-between gap-3">{children ? <div>{children}</div> : <span/>}{action}</div>
  </MantineAlert>
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}) {
  return <MantineSwitch
    checked={checked}
    onChange={event => onCheckedChange(event.currentTarget.checked)}
    disabled={disabled}
    aria-label={ariaLabel}
    className="ui-switch"
  />
}

/** 图标按钮：用于记录行的紧凑动作，必须带可访问名称。 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & { label: string; icon: ReactNode; danger?: boolean }>(function IconButton({ label, icon, danger, className, ...rest }, ref) {
  return <ActionIcon
    ref={ref}
    variant="subtle"
    color={danger ? 'red' : 'gray'}
    size="lg"
    aria-label={label}
    title={label}
    className={clsx('ui-iconbtn', danger && 'ui-iconbtn--danger', className)}
    {...rest}
  >{icon}</ActionIcon>
})
