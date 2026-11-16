/**
 * 对话框与就近确认气泡：Radix Dialog / Popover + 共享按钮。
 *
 * 关闭后焦点由 Radix 交还触发元素；遮罩使用 --scrim，深色主题下仍然压暗。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Icon } from '../Icon'
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-[300] bg-scrim/40"/>
      <DialogPrimitive.Content
        className="fixed left-1/2 top-1/2 z-[301] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border-soft bg-card p-5 text-foreground shadow-3"
        style={{ width: `min(92vw, ${width}px)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogPrimitive.Title className="text-lg font-semibold leading-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <button type="button" aria-label="关闭" className="grid size-7 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-foreground-4 hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Icon name="close" size={14}/></button>
          </DialogPrimitive.Close>
        </div>
        {description ? <DialogPrimitive.Description className="mt-1 text-xs text-foreground-3">{description}</DialogPrimitive.Description> : null}
        <div className="mt-4">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
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
  const target = icon
    ? <IconButton label={ariaLabel ?? confirmText} icon={icon} danger={danger} disabled={disabled}/>
    : <Button variant="link" size="sm" danger={danger} disabled={disabled}>{label}</Button>
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger asChild>{target}</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="top"
        align="end"
        sideOffset={6}
        className="z-[400] w-60 rounded-md border border-border-soft bg-popover p-3 text-popover-foreground shadow-2"
      >
        <p className="text-sm font-semibold">{title}</p>
        {description ? <p className="mt-1 text-xs text-foreground-3">{description}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => setOpen(false)}>{cancelText}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={() => { setOpen(false); onConfirm() }}>{confirmText}</Button>
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}
