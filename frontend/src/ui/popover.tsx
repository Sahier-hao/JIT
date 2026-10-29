import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useState, type ReactNode } from 'react'

/** 贴在触发元素旁的浮层：用于记录详情这类不适合在列表内展开的内容。 */
export function Popover({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className="ui-popover" side="left" align="start" sideOffset={8} aria-label={label}>
        {children}
        <PopoverPrimitive.Arrow className="ui-popover-arrow"/>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}
