/**
 * 右侧抽屉：Radix Dialog 的侧滑面板。
 *
 * 内容只在打开时挂载；关闭按钮、Esc 与遮罩点击都回到 onClose，
 * 焦点由 Radix 交还触发元素。
 */
import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'

export function Drawer({ open, onOpenChange, onClose, title, children, width = 600 }: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  title: ReactNode
  children: ReactNode
  width?: number
}) {
  const close = () => { onOpenChange?.(false); onClose?.() }
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (value) onOpenChange?.(true); else close() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[300] bg-scrim/40"/>
      <DialogPrimitive.Content
        className="fixed inset-y-0 right-0 z-[301] flex flex-col border-l border-border-soft bg-card text-foreground shadow-3"
        style={{ width: `min(100vw, ${width}px)` }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3">
          <DialogPrimitive.Title className="text-lg font-semibold leading-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <button type="button" aria-label="关闭" className="grid size-7 shrink-0 place-items-center rounded-sm border-0 bg-transparent text-foreground-4 hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"><Icon name="close" size={14}/></button>
          </DialogPrimitive.Close>
        </header>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
