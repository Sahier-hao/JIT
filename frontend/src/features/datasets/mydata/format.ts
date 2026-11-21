import { formatDate, valueLabel, type Row } from '@/features/admin/adminContracts'
import type { UserDataset } from '@/features/account/userClient'

export const DEFAULT_PRESET = 'temporal-70-15-15'
export const BUILD_ACTIVE = new Set(['queued', 'running'])
export const BUILD_RETRYABLE = new Set(['failed', 'cancelled', 'interrupted'])
export const BUILD_STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '构建中', completed: '已完成', failed: '失败',
  cancelled: '已取消', interrupted: '已中断',
}
export const BUILD_STAGE_LABELS: Record<string, string> = {
  queued: '等待采集', collecting: '采集中', registering: '登记中',
  completed: '完成', failed: '失败', cancelled: '取消', interrupted: '中断',
}
export const EXCLUSION_LABELS: Record<string, string> = {
  empty: '空提交', merges: '合并提交', outsideWindow: '时间窗口外', unparsed: '无法解析',
  noAddedLines: '无新增行', tooManyFiles: '文件过多', tooMuchChurn: '改动过大',
  missingRequiredField: '缺少必需字段',
}

export type DatasetTab = 'mine' | 'shared' | 'builds'

export function usageLabel(usage: string, details?: Pick<UserDataset, 'curation' | 'source'>): string {
  if (details?.curation) return '清洗派生'
  if (usage === 'import') {
    const upload = details?.source.upload
    return typeof upload === 'string' && upload.toLowerCase().endsWith('.zip') ? 'ZIP 导入' : 'CSV 导入'
  }
  return usage === 'pr' ? 'PR 采集' : '仓库采集'
}

const PROJECT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  bugzilla: 'Bugzilla', columba: 'Columba', jdt: 'Eclipse JDT',
  mozilla: 'Mozilla', platform: 'Eclipse Platform', postgres: 'PostgreSQL',
})

export function datasetTitle(item: UserDataset): string {
  const project = item.source.project
  return typeof project === 'string' ? (Object.hasOwn(PROJECT_NAMES, project) ? PROJECT_NAMES[project] : project) : item.dataset
}

export function timestampLabel(item: UserDataset): string {
  if (item.timestamps.builtAt) return `构建 ${formatDate(item.timestamps.builtAt)}`
  if (item.timestamps.importedAt) return `导入 ${formatDate(item.timestamps.importedAt)}`
  if (item.timestamps.ownedAt) return `归属 ${formatDate(item.timestamps.ownedAt)}`
  if (item.timestamps.registeredAt) return `登记 ${formatDate(item.timestamps.registeredAt)}`
  return '时间未记录'
}

export function asRow(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
}

export function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function numberText(value: unknown): string {
  const parsed = numeric(value)
  return parsed == null ? valueLabel(value) : parsed.toLocaleString('zh-CN')
}

export function ratioText(part: number | null, total: number | null): string | null {
  if (part == null || total == null || total <= 0) return null
  return `${(part / total * 100).toFixed(1)}%`
}

export function bytesText(value: unknown): string {
  const bytes = numeric(value)
  if (bytes == null) return valueLabel(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function commitText(value: unknown): string {
  return typeof value === 'string' ? (value.length > 12 ? value.slice(0, 12) : value) : ''
}

export function repositoryLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    return path || url
  } catch {
    return url
  }
}

export function matchesQuery(item: UserDataset, query: string): boolean {
  if (!query) return true
  const source = typeof item.source.url === 'string' ? item.source.url : ''
  return `${datasetTitle(item)} ${item.dataset} ${item.version} ${source}`.toLowerCase().includes(query)
}
