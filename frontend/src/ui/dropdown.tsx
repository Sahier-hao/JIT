import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DropdownItem { key: string; label: ReactNode; danger?: boolean; disabled?: boolean }

/** 点击触发的操作菜单；替代 antd Dropdown 的受控用法。 */
export function Dropdown({ children, items, onClick, open, onOpenChange, align = 'end' }: {
  children: ReactNode
  items: DropdownItem[]
  onClick: (key: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className="z-[70] min-w-40 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[var(--sh-2)] outline-none"
      >
        {items.map(item => <DropdownMenu.Item
          key={item.key}
          disabled={item.disabled}
          onSelect={() => onClick(item.key)}
          className={cn('flex cursor-default select-none items-center rounded px-2.5 py-1.5 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--hover)]',
            item.danger && 'text-[var(--risk-high)] data-[highlighted]:bg-[var(--risk-soft)]')}
        >{item.label}</DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
