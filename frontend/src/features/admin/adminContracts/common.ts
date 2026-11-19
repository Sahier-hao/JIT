import { textOrNull } from '@/lib/apiContract'

export type Row = Record<string, unknown>


export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const
export const ACTIVE_TASK_STATUSES: readonly string[] = ['queued', 'running']
export const ADMIN_READ_TIMEOUT_MS = 30_000

export function valueLabel(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

export function metricValue(metrics: Row | null | undefined, key: string): number | null {
  if (!metrics || typeof metrics[key] !== 'object' || metrics[key] === null) return null
  const entry = metrics[key] as Row
  return typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null
}

export function metricReason(metrics: Row | null | undefined, key: string): string | null {
  if (!metrics || typeof metrics[key] !== 'object' || metrics[key] === null) return null
  return textOrNull((metrics[key] as Row).reason)
}

export function formatDate(value: unknown) {
  if (typeof value !== 'string') return '未提供'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

