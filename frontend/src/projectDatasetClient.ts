import { apiDownload, apiRequest } from './apiClient'
import { finiteNumber, record, text, textOrNull, utcTimestamp } from './apiContract'

export interface ProjectDataset {
  syncId: string
  datasetId: string
  version: string
  schema: string
  timeRange: { start: string; end: string }
  quality: Record<string, unknown>
  file: { name: string; sha256: string; bytes: number }
  source: {
    publisher: string | null
    url: string | null
    revision: string | null
    citation: string | null
    branch: string | null
    head: string | null
    window: Record<string, unknown> | null
  }
  labelRule: string | null
  limitations: string[]
}

function nonNegative(value: unknown): number {
  const result = finiteNumber(value)
  if (result < 0 || !Number.isSafeInteger(result)) throw new Error('数据集文件大小无效')
  return result
}

export async function fetchProjectDataset(repositoryId: string, syncId: string, signal?: AbortSignal): Promise<ProjectDataset> {
  const raw = record(await apiRequest({
    path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/analyses/${encodeURIComponent(syncId)}/dataset`,
    method: 'GET',
    signal,
  }))
  const file = record(raw.file)
  const source = record(raw.source)
  const range = record(raw.timeRange)
  return {
    syncId: text(raw.syncId),
    datasetId: text(raw.datasetId),
    version: text(raw.version),
    schema: text(raw.schema),
    timeRange: { start: utcTimestamp(range.start), end: utcTimestamp(range.end) },
    quality: record(raw.quality),
    file: { name: text(file.name), sha256: text(file.sha256), bytes: nonNegative(file.bytes) },
    source: {
      publisher: textOrNull(source.publisher),
      url: textOrNull(source.url),
      revision: textOrNull(source.revision),
      citation: textOrNull(source.citation),
      branch: textOrNull(source.branch),
      head: textOrNull(source.head),
      window: source.window == null ? null : record(source.window),
    },
    labelRule: textOrNull(raw.labelRule),
    limitations: Array.isArray(raw.limitations) ? raw.limitations.map(item => text(item)) : [],
  }
}

export async function downloadProjectDataset(
  repositoryId: string,
  syncId: string,
  format: 'zip' | 'xlsx',
  signal?: AbortSignal,
): Promise<void> {
  const { blob, filename } = await apiDownload(
    `/api/v1/repositories/${encodeURIComponent(repositoryId)}/analyses/${encodeURIComponent(syncId)}/dataset/export/${format}`,
    signal,
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
