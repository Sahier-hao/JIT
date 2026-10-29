import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useState, type ReactNode } from 'react'

/** 贴在触发元素旁的浮层：用于记录菜单、记录详情这类不适合在列表内展开的内容。 */
export function Popover({ trigger, children, label, open, onOpenChange }: {
  trigger: ReactNode
  children: ReactNode
  label?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internal, setInternal] = useState(false)
  const controlled = open !== undefined
  return <PopoverPrimitive.Root open={controlled ? open : internal} onOpenChange={controlled ? onOpenChange : setInternal}>
    <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="left"
        align="start"
        sideOffset={8}
        aria-label={label}
        className="z-[60] w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-[var(--sh-2)] outline-none"
      >
        {children}
        <PopoverPrimitive.Arrow className="fill-[var(--card)]"/>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}
