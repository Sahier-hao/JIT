import { Menu } from '@mantine/core'
import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface DropdownItem { key: string; label: ReactNode; danger?: boolean; disabled?: boolean }

/** 点击触发的操作菜单：由 Mantine Menu 渲染。 */
export function Dropdown({ children, items, onClick, open, onOpenChange, align = 'end' }: {
  children: ReactNode
  items: DropdownItem[]
  onClick: (key: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
}) {
  return <Menu opened={open} onChange={onOpenChange} position={align === 'center' ? 'bottom' : `bottom-${align}`} withinPortal>
    <Menu.Target>{children}</Menu.Target>
    <Menu.Dropdown>
      {items.map(item => <Menu.Item
        key={item.key}
        disabled={item.disabled}
        color={item.danger ? 'red' : undefined}
        className={clsx(item.danger && 'ui-menu-danger')}
        onClick={() => onClick(item.key)}
      >{item.label}</Menu.Item>)}
    </Menu.Dropdown>
  </Menu>
}
