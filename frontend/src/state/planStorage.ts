import type { Dataset } from '../domain'

export type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>
const browserStorage: StorageAccess = () => window.localStorage

/**
 * 审查计划的存储身份：同一 SHA 在不同仓库、不同分析里必须互不越界。
 * 仓库来源必须三要素齐全（仓库、作业、数据集版本）；缺任一即视为身份未确认，宁可不存。
 */
export function sourceContext(data: Dataset): string {
  if (data.mode === 'repository') {
    if (!data.repository?.repositoryId || !data.repository.syncId || !data.repository.datasetVersion) throw new Error('分析身份尚未确认')
    return JSON.stringify(['repository', data.repository.repositoryId, data.repository.syncId, data.repository.datasetVersion])
  }
  return JSON.stringify([data.mode, data.project, data.version, data.runId ?? ''])
}

export function storageKey(data: Dataset): string {
  return `jit-review:plan:v3:${encodeURIComponent(sourceContext(data))}`
}

interface Entry { commitId: string; sourceContext: string; addedAt: string }

function entries(data: Dataset, access: StorageAccess): Entry[] {
  const raw = access().getItem(storageKey(data))
  if (raw === null) return []
  const saved = JSON.parse(raw)
  const context = sourceContext(data)
  if (saved?.schema !== 3 || saved.sourceContext !== context || !Array.isArray(saved.entries)) throw new Error('存储格式不支持')
  if (!saved.entries.every((item: Entry) => item && typeof item.commitId === 'string' && item.commitId && item.sourceContext === context && typeof item.addedAt === 'string' && Number.isFinite(Date.parse(item.addedAt)))) throw new Error('存储格式损坏')
  return saved.entries
}

export function restoreShortlist(data: Dataset, access: StorageAccess = browserStorage): { ids: string[]; warning: string } {
  try {
    return { ids: [...new Set(entries(data, access).map(item => item.commitId))], warning: '' }
  } catch {
    return { ids: [], warning: '审查计划恢复失败；原存储保留，可以重新选择。' }
  }
}

export function saveShortlist(data: Dataset, ids: string[], access: StorageAccess = browserStorage): string {
  try {
    const context = sourceContext(data)
    let existing: Entry[] = []
    try { existing = entries(data, access) } catch { /* A deliberate new selection can replace damaged v3 data. */ }
    const wanted = [...new Set(ids)]
    const next = wanted.map(commitId => existing.find(item => item.commitId === commitId) ?? { commitId, sourceContext: context, addedAt: new Date().toISOString() })
    access().setItem(storageKey(data), JSON.stringify({ schema: 3, sourceContext: context, entries: next }))
    return ''
  } catch {
    return '本次审查计划未能保存，刷新后可能丢失'
  }
}

export function previewLegacyPlan(data: Dataset, access: StorageAccess = browserStorage): { ids: string[]; warning: string } {
  try {
    sourceContext(data) // A repository must already have a verified analysis identity.
    const key = data.mode === 'repository' ? `jit-review:shortlist:v2:repository:${encodeURIComponent(data.repository!.syncId)}`
      : data.mode === 'historical' ? `jit-review:shortlist:v2:historical:${encodeURIComponent(data.project)}:${encodeURIComponent(data.version)}:${encodeURIComponent(data.runId!)}`
      : `jit-review:shortlist:v1:${encodeURIComponent(data.project)}:${encodeURIComponent(data.version)}`
    const raw = access().getItem(key)
    if (!raw) return { ids: [], warning: '' }
    const saved = JSON.parse(raw)
    if (saved?.schema !== 1 || !Array.isArray(saved.ids) || !saved.ids.every((id: unknown) => typeof id === 'string' && id)) throw new Error('旧清单格式损坏')
    return { ids: [...new Set<string>(saved.ids)], warning: '' }
  } catch {
    return { ids: [], warning: '旧清单无法核对来源或格式；保留原数据，不自动迁入。' }
  }
}

export function migrateLegacyPlan(data: Dataset, verifiedIds: string[], access: StorageAccess = browserStorage): string {
  const preview = previewLegacyPlan(data, access)
  if (preview.warning) return preview.warning
  const current = restoreShortlist(data, access)
  if (current.warning) return current.warning
  return saveShortlist(data, [...current.ids, ...verifiedIds.filter(id => preview.ids.includes(id))], access)
}
