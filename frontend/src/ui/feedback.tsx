import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { InlineAlert } from './controls'

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full border border-border bg-[var(--sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--fg-2)]', className)}>{children}</span>
}

export function Tooltip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  if (!title) return <>{children}</>
  return <TooltipPrimitive.Provider delayDuration={200}>
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[80] max-w-64 rounded-md bg-[var(--btn)] px-2 py-1 text-xs text-[var(--btn-fg)] shadow-[var(--sh-2)]"
        >
          {title}
          <TooltipPrimitive.Arrow className="fill-[var(--btn)]"/>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>
}

export function Empty({ description = '暂无内容' }: { description?: ReactNode }) {
  return <div className="py-8 text-center text-[13px] text-muted-foreground">{description}</div>
}

/** 与 antd Alert 的常用参数保持同名，tone 由类型推导。 */
export function Alert({ type = 'info', title, children, action }: {
  type?: 'info' | 'success' | 'warning' | 'error'
  showIcon?: boolean
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return <InlineAlert tone={type === 'error' || type === 'warning' ? 'alert' : 'info'} title={title} action={action}>{children}</InlineAlert>
}

export function Space({ children, size = 8, wrap, className }: { children: ReactNode; size?: number; wrap?: boolean; className?: string }) {
  return <div className={cn('flex items-center', wrap && 'flex-wrap', className)} style={{ gap: size }}>{children}</div>
}
