import { Alert as MantineAlert, Badge, Group, Text, Tooltip as MantineTooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Info } from 'lucide-react'

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <Badge variant="light" color="gray" size="sm" className={clsx('ui-tag', className)}>{children}</Badge>
}

export function Tooltip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  if (!title) return <>{children}</>
  return <MantineTooltip label={title} withArrow withinPortal openDelay={200}>{children}</MantineTooltip>
}

export function Empty({ description = '暂无内容' }: { description?: ReactNode }) {
  return <Text c="dimmed" size="sm" ta="center" py="xl">{description}</Text>
}

/** 与 antd Alert 的常用参数保持同名，颜色由类型推导。 */
export function Alert({ type = 'info', title, children, action }: {
  type?: 'info' | 'success' | 'warning' | 'error'
  showIcon?: boolean
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const color = type === 'error' ? 'red' : type === 'warning' ? 'yellow' : type === 'success' ? 'green' : 'blue'
  return <MantineAlert color={color} title={title} icon={<Info size={16}/>} className={clsx('ui-alert', `ui-alert--${type}`)}>
    <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
      <div>{children}</div>
      {action}
    </Group>
  </MantineAlert>
}

export function Space({ children, size = 8, wrap, className }: { children: ReactNode; size?: number; wrap?: boolean; className?: string }) {
  return <Group gap={size} wrap={wrap ? 'wrap' : 'nowrap'} className={className}>{children}</Group>
}
