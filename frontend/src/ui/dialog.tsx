/**
 * 对话框与就近确认气泡：由 Mantine Modal / Popover 渲染。
 */
import { Button as MantineButton, Group, Modal, Popover as MantinePopover, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, IconButton } from './controls'

export function Dialog({ open, onOpenChange, title, description, footer, children, width = 600 }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  width?: number
}) {
  return <Modal
    opened={open}
    onClose={() => onOpenChange(false)}
    title={title}
    size={width}
    centered
    className="ui-dialog"
  >
    {description ? <Text c="dimmed" size="sm" mb="md">{description}</Text> : null}
    {children}
    {footer ? <Group justify="flex-end" mt="lg">{footer}</Group> : null}
  </Modal>
}

/** 贴在触发按钮旁的确认气泡：替代把确认面板放到列表末尾的做法。 */
export function Popconfirm({ label, icon, ariaLabel, title, description, confirmText, cancelText = '取消', onConfirm, danger, disabled }: {
  label?: ReactNode
  icon?: ReactNode
  ariaLabel?: string
  title: ReactNode
  description?: ReactNode
  confirmText: string
  cancelText?: string
  onConfirm: () => void
  danger?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const target = icon
    ? <IconButton label={ariaLabel ?? confirmText} icon={icon} danger={danger} disabled={disabled} onClick={() => setOpen(value => !value)}/>
    : <Button variant="link" size="sm" danger={danger} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>{label}</Button>
  return <MantinePopover opened={open} onChange={setOpen} position="top-end" withArrow shadow="md" withinPortal>
    <MantinePopover.Target>{target}</MantinePopover.Target>
    <MantinePopover.Dropdown w={240}>
      <Text fw={600} size="sm">{title}</Text>
      {description ? <Text size="xs" c="dimmed" mt={4}>{description}</Text> : null}
      <Group justify="flex-end" mt="md">
        <MantineButton size="xs" variant="default" onClick={() => setOpen(false)}>{cancelText}</MantineButton>
        <MantineButton size="xs" color={danger ? 'red' : undefined} onClick={() => { setOpen(false); onConfirm() }}>{confirmText}</MantineButton>
      </Group>
    </MantinePopover.Dropdown>
  </MantinePopover>
}
