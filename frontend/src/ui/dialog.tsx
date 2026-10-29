/**
 * 对话框与就近确认气泡。与 controls.tsx 一样：行为由 Radix 提供，外观用语义令牌。
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40"/>
      <DialogPrimitive.Content
        className="ui-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[min(720px,calc(100vh-48px))] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-foreground shadow-[var(--sh-2)] outline-none"
        style={{ width }}
        aria-describedby={description ? undefined : ''}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <DialogPrimitive.Title className="m-0 text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label="关闭" className="inline-flex size-8 items-center justify-center rounded-md text-[var(--fg-3)] hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={15}/>
          </DialogPrimitive.Close>
        </header>
        {description ? <DialogPrimitive.Description className="px-5 pt-3 text-[13px] text-muted-foreground">{description}</DialogPrimitive.Description> : null}
        <div className="ui-dialog-body min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer> : null}
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
      <span className="inline-flex">
        {icon ? <IconButton label={ariaLabel ?? confirmText} icon={icon} danger={danger} disabled={disabled} onClick={() => setOpen(value => !value)}/> : <Button variant="link" size="sm" danger={danger} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>{label}</Button>}
      </span>
    </PopoverPrimitive.Anchor>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="top"
        align="end"
        sideOffset={8}
        className="z-[70] w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-[var(--sh-2)] outline-none"
      >
        <p className="m-0 text-[13px] font-semibold">{title}</p>
        {description ? <p className="mb-0 mt-1 text-xs text-muted-foreground">{description}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => setOpen(false)}>{cancelText}</Button>
          <Button size="sm" variant={danger ? 'danger' : 'primary'} onClick={() => { setOpen(false); onConfirm() }}>{confirmText}</Button>
        </div>
        <PopoverPrimitive.Arrow className="fill-[var(--card)]"/>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}
