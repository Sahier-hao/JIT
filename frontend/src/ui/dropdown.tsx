/**
 * 点击触发的操作菜单：Radix DropdownMenu。
 *
 * 支持受控与非受控两种用法，保留原有 `items / onClick` 语义。
 */
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export interface DropdownItem { key: string; label: ReactNode; danger?: boolean; disabled?: boolean }

export function Dropdown({ children, items, onClick, open, onOpenChange, align = 'end' }: {
  children: ReactNode
  items: DropdownItem[]
  onClick: (key: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  return <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenuPrimitive.Trigger asChild>{children}</DropdownMenuPrimitive.Trigger>
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={6}
        className="z-[400] min-w-40 rounded-md border border-border-soft bg-popover p-1 text-popover-foreground shadow-2"
      >
        {items.map(item => <DropdownMenuPrimitive.Item
          key={item.key}
          disabled={item.disabled}
          onSelect={() => onClick(item.key)}
          className={cn(
            'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
            item.danger && 'text-rose data-[highlighted]:bg-rose-soft data-[highlighted]:text-rose-deep',
          )}
        >{item.label}</DropdownMenuPrimitive.Item>)}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  </DropdownMenuPrimitive.Root>
}
