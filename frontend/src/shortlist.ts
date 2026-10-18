import type { Dataset } from './domain'
export type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>
const browserStorage: StorageAccess = () => window.localStorage
export function storageKey(data: Dataset): string {
  if (data.mode === 'historical') return `jit-review:shortlist:v2:historical:${encodeURIComponent(data.project)}:${encodeURIComponent(data.version)}:${encodeURIComponent(data.runId!)}`
  // 每次同步是一个独立上下文：同一个仓库再次同步后风险会变，旧清单不跨作业沿用。
  if (data.mode === 'repository') return `jit-review:shortlist:v2:repository:${encodeURIComponent(data.repository?.syncId ?? '')}`
  return `jit-review:shortlist:v1:${encodeURIComponent(data.project)}:${encodeURIComponent(data.version)}`
}
export function restoreShortlist(data: Dataset, access: StorageAccess = browserStorage): { ids: string[]; warning: string } {
  try {
    const raw = access().getItem(storageKey(data))
    if (raw === null) return { ids: [], warning: '' }
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object' || !('schema' in saved) || saved.schema !== 1 || !('ids' in saved) || !Array.isArray(saved.ids) || !saved.ids.every(id => typeof id === 'string')) throw new Error('存储格式不支持')
    const valid = new Set(data.records.map(record => record.id))
    // 仓库模式只加载了首屏一页，`records` 不是全集：按它过滤会把大多数清单项误删。
    // 这些标识是否仍属于本次同步，由清单视图逐条读取时确认（取不到的单独提示）。
    const ids = data.mode === 'repository' ? [...new Set<string>(saved.ids)] : [...new Set<string>(saved.ids)].filter(id => valid.has(id))
    const missing = data.mode !== 'repository' && saved.ids.some(id => !valid.has(id))
    return { ids, warning: missing ? '部分清单记录恢复失败，已排除当前数据中不存在的提交；可以继续选择。' : '' }
  } catch {
    return { ids: [], warning: '清单恢复失败，可以重新选择提交；本次仍可正常使用。' }
  }
}
export function saveShortlist(data: Dataset, ids: string[], access: StorageAccess = browserStorage): string {
  try {
    access().setItem(storageKey(data), JSON.stringify({ schema: 1, ids }))
    return ''
  } catch {
    return '本次清单未能保存，刷新后可能丢失'
  }
}
