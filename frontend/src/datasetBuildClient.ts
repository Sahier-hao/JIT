import { apiRequest } from './apiClient'
import { flag, record, recordList, text, textOrNull } from './apiContract'

export type DatasetBuildStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface DatasetBuildTask {
  taskId: string
  repositoryId: string
  repositoryUrl: string
  branch: string
  since: string | null
  until: string | null
  commitLimit: number
  status: DatasetBuildStatus
  stage: string
  error: { code: string; message: string } | null
  parentTaskId: string | null
  datasetName: string | null
  datasetVersion: string | null
  manifestSha256: string | null
  quality: Record<string, unknown> | null
  reused: boolean
  headCommit: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  queuePosition: number | null
}

function countOrNull(value: unknown): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('任务队列位置无效')
  return value
}

export function parseDatasetBuild(raw: unknown, repositoryId: string): DatasetBuildTask {
  const value = record(raw)
  if (value.repositoryId !== repositoryId) throw new Error('数据集任务不属于当前项目')
  const status = text(value.status)
  if (!['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(status)) throw new Error('数据集任务状态未登记')
  const error = value.error == null ? null : record(value.error)
  return {
    taskId: text(value.taskId),
    repositoryId,
    repositoryUrl: text(value.repositoryUrl),
    branch: text(value.branch),
    since: textOrNull(value.since),
    until: textOrNull(value.until),
    commitLimit: countOrNull(value.commitLimit) ?? 0,
    status: status as DatasetBuildStatus,
    stage: text(value.stage),
    error: error ? { code: text(error.code), message: text(error.message) } : null,
    parentTaskId: textOrNull(value.parentTaskId),
    datasetName: textOrNull(value.datasetName),
    datasetVersion: textOrNull(value.datasetVersion),
    manifestSha256: textOrNull(value.manifestSha256),
    quality: value.quality == null ? null : record(value.quality),
    reused: flag(value.reused),
    headCommit: textOrNull(value.headCommit),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    completedAt: textOrNull(value.completedAt),
    queuePosition: countOrNull(value.queuePosition),
  }
}

export async function createDatasetBuild(repositoryId: string, body: { branch: string; since?: string; until?: string }) {
  const id = encodeURIComponent(repositoryId)
  return parseDatasetBuild(await apiRequest({
    path: `/api/v1/repositories/${id}/dataset-builds`,
    method: 'POST',
    body,
  }), repositoryId)
}

export async function getDatasetBuild(repositoryId: string, taskId: string, signal?: AbortSignal) {
  const id = encodeURIComponent(repositoryId)
  return parseDatasetBuild(await apiRequest({
    path: `/api/v1/repositories/${id}/dataset-builds/${encodeURIComponent(taskId)}`,
    method: 'GET',
    signal,
  }), repositoryId)
}

export async function listDatasetBuilds(repositoryId: string, signal?: AbortSignal) {
  const id = encodeURIComponent(repositoryId)
  const value = record(await apiRequest({
    path: `/api/v1/repositories/${id}/dataset-builds?limit=20&offset=0`,
    method: 'GET',
    signal,
  }))
  return recordList(value.tasks).map(item => parseDatasetBuild(item, repositoryId))
}

export async function cancelDatasetBuild(repositoryId: string, taskId: string) {
  const id = encodeURIComponent(repositoryId)
  return parseDatasetBuild(await apiRequest({
    path: `/api/v1/repositories/${id}/dataset-builds/${encodeURIComponent(taskId)}/cancel`,
    method: 'POST',
  }), repositoryId)
}

export async function retryDatasetBuild(repositoryId: string, taskId: string) {
  const id = encodeURIComponent(repositoryId)
  return parseDatasetBuild(await apiRequest({
    path: `/api/v1/repositories/${id}/dataset-builds/${encodeURIComponent(taskId)}/retry`,
    method: 'POST',
  }), repositoryId)
}
