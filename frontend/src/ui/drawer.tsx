import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/** 右侧抽屉：替代 antd Drawer，保留标题、关闭按钮与宽度参数。 */
export function Drawer({ open, onOpenChange, onClose, title, children, width = 600 }: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  title: ReactNode
  children: ReactNode
  width?: number
}) {
  const change = (next: boolean) => { onOpenChange?.(next); if (!next) onClose?.() }
  return <DialogPrimitive.Root open={open} onOpenChange={change}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40"/>
      <DialogPrimitive.Content
        className="ui-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-[calc(100vw-24px)] flex-col border-l border-border bg-popover text-foreground shadow-[var(--sh-2)] outline-none"
        style={{ width }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <DialogPrimitive.Title className="m-0 text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close aria-label="关闭" className="inline-flex size-8 items-center justify-center rounded-md text-[var(--fg-3)] hover:bg-[var(--hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={15}/></DialogPrimitive.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
