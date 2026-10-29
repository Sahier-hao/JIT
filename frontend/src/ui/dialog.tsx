/**
 * 对话框与就近确认气泡。与 controls.tsx 一样：行为由 Radix 提供，外观由 ui.css 决定。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, IconButton } from './controls'

export function Dialog({ open, onOpenChange, title, description, footer, children, width = 600 }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  width?: number
}) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay"/>
      <DialogPrimitive.Content className="ui-dialog" style={{ width }} aria-describedby={description ? undefined : ''}>
        <header className="ui-dialog-head">
          <DialogPrimitive.Title className="ui-dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="ui-dialog-close" aria-label="关闭"><X size={15}/></DialogPrimitive.Close>
        </header>
        {description ? <DialogPrimitive.Description className="ui-dialog-desc">{description}</DialogPrimitive.Description> : null}
        <div className="ui-dialog-body">{children}</div>
        {footer ? <footer className="ui-dialog-foot">{footer}</footer> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

/** 贴在触发按钮旁的确认气泡：替代把确认面板放到列表末尾的做法。 */
export function Popconfirm({ label, icon, ariaLabel, title, description, confirmText, cancelText = '取消', onConfirm, danger, disabled }: {
  label?: ReactNode
  icon?: ReactNode
  ariaLabel?: string
  title: ReactNode
  description?: ReactNode
  confirmText: string
  cancelText?: string
  onConfirm: () => void
  danger?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Anchor asChild>
      <span className="ui-popconfirm-anchor">
        {icon ? <IconButton label={ariaLabel ?? confirmText} icon={icon} danger={danger} disabled={disabled} onClick={() => setOpen(value => !value)}/> : <Button variant="link" size="sm" danger={danger} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>{label}</Button>}
      </span>
    </PopoverPrimitive.Anchor>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className="ui-popconfirm" side="top" align="end" sideOffset={8}>
        <p className="ui-popconfirm-title">{title}</p>
        {description ? <p className="ui-popconfirm-text">{description}</p> : null}
        <div className="ui-popconfirm-actions">
          <Button size="sm" onClick={() => setOpen(false)}>{cancelText}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={() => { setOpen(false); onConfirm() }}>{confirmText}</Button>
        </div>
        <PopoverPrimitive.Arrow className="ui-popconfirm-arrow"/>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}
