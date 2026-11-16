/**
 * 反馈组件：标签、提示、空状态、警报与行内间距。
 *
 * 全部使用共享令牌与工具类；提示用 Radix Tooltip，触发器必须是单个元素。
 */
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { Icon } from '../Icon'

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-sm border border-border-soft bg-soft px-1.5 py-0.5 text-xs leading-4 text-foreground-3', className)}>{children}</span>
}

export function Tooltip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  if (!title) return <>{children}</>
  return <TooltipPrimitive.Provider delayDuration={200}>
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-[400] max-w-xs rounded-sm border border-border-soft bg-popover px-2 py-1 text-xs leading-5 text-foreground shadow-2"
        >
          {title}
          <TooltipPrimitive.Arrow className="fill-[var(--card)]"/>
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>
}

export function Empty({ description = '暂无内容' }: { description?: ReactNode }) {
  return <p className="py-8 text-center text-xs text-foreground-3">{description}</p>
}

const alertTones = {
  info: 'border-blue/30 bg-blue-soft text-blue-deep',
  success: 'border-teal/30 bg-teal-soft text-teal-deep',
  warning: 'border-amber/30 bg-amber-soft text-amber-deep',
  error: 'border-rose/40 bg-rose-soft text-rose-deep',
} as const

/** 与原有调用参数保持同名；颜色由类型推导。 */
export function Alert({ type = 'info', title, children, action }: {
  type?: 'info' | 'success' | 'warning' | 'error'
  showIcon?: boolean
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return <div role={type === 'error' ? 'alert' : 'note'} className={cn('flex gap-2 rounded-sm border p-3 text-sm', alertTones[type])}>
    <Icon name={type === 'error' || type === 'warning' ? 'warning' : 'info'} size={16} className="mt-0.5 shrink-0"/>
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {children ? <div className="mt-0.5">{children}</div> : null}
      </div>
      {action}
    </div>
  </div>
}

export function Space({ children, size = 8, wrap, className }: { children: ReactNode; size?: number; wrap?: boolean; className?: string }) {
  return <div className={cn('flex', wrap ? 'flex-wrap' : 'flex-nowrap', className)} style={{ gap: size }}>{children}</div>
}
