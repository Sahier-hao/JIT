import { Drawer as MantineDrawer } from '@mantine/core'
import type { ReactNode } from 'react'

/** 右侧抽屉：由 Mantine Drawer 渲染。 */
export function Drawer({ open, onOpenChange, onClose, title, children, width = 600 }: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onClose?: () => void
  title: ReactNode
  children: ReactNode
  width?: number
}) {
  return <MantineDrawer
    opened={open}
    onClose={() => { onOpenChange?.(false); onClose?.() }}
    title={title}
    position="right"
    size={width}
    className="ui-drawer"
    overlayProps={{ backgroundOpacity: 0.4, blur: 0 }}
  >{children}</MantineDrawer>
}
