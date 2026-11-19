import { apiRequest } from '@/lib/apiClient'
import { record, recordList, text, textList, textOrNull } from '@/lib/apiContract'
import { type Row, ADMIN_READ_TIMEOUT_MS } from './common'

export interface AdminDatasetVersion {
  dataset: string
  version: string
  schema: string
  timeRange: Row
  quality: Row
  file: Row
  manifestPath: string | null
  source: Row
  labelRule: string | null
  labelMaturity: Row | null
  label: Row
  szz: Row
  labelObservations: Row | null
  limitations: string[]
  usage: 'branch' | 'pr'
  sourceSyncId: string | null
  references: string[]
  owners: string[]
  shared: boolean
}


function datasetVersion(raw: unknown, dataset: string): AdminDatasetVersion {
  const value = record(raw)
  return {
    dataset,
    version: text(value.version),
    schema: text(value.schema),
    timeRange: record(value.timeRange),
    quality: record(value.quality),
    file: record(value.file),
    manifestPath: textOrNull(value.manifestPath),
    source: record(value.source),
    labelRule: textOrNull(value.labelRule),
    labelMaturity: value.labelMaturity == null ? null : record(value.labelMaturity),
    label: value.label === undefined ? {} : record(value.label),
    szz: value.szz === undefined ? {} : record(value.szz),
    labelObservations: value.labelObservations == null ? null : record(value.labelObservations),
    limitations: textList(value.limitations),
    usage: value.usage === 'pr' ? 'pr' : 'branch',
    sourceSyncId: textOrNull(value.sourceSyncId),
    references: Array.isArray(value.references) ? textList(value.references) : [],
    owners: Array.isArray(value.owners) ? textList(value.owners) : [],
    shared: value.shared === true,
  }
}

export async function fetchAdminDatasets(signal?: AbortSignal): Promise<AdminDatasetVersion[]> {
  const body = record(await apiRequest({ path: '/api/v1/datasets', method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
  return recordList(body.datasets).flatMap(group => {
    const value = record(group)
    const dataset = text(value.dataset)
    return recordList(value.versions).map(version => datasetVersion(version, dataset))
  })
}

export async function setAdminDatasetSharing(version: string, shared: boolean): Promise<{ version: string; shared: boolean }> {
  const value = record(await apiRequest({
    path: `/api/admin/datasets/${encodeURIComponent(version)}/sharing`,
    method: 'PUT',
    body: { shared },
  }))
  return { version: text(value.version), shared: value.shared === true }
}

export interface PrunableDatasetVersion {
  dataset: string
  version: string
  createdAt: string
}

export async function fetchPrunableDatasets(keep: number, signal?: AbortSignal): Promise<PrunableDatasetVersion[]> {
  const body = record(await apiRequest({ path: `/api/admin/datasets/prunable?keep=${encodeURIComponent(String(keep))}`, method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
  return recordList(body.versions).map(item => ({
    dataset: text(item.dataset), version: text(item.version), createdAt: text(item.createdAt),
  }))
}

export async function pruneDatasets(versions: string[], keep: number) {
  return record(await apiRequest({ path: '/api/admin/datasets/prune', method: 'POST', body: { versions, keep } }))
}

