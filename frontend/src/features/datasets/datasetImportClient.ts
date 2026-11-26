import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/apiClient'
import { finiteNumber, record, recordList, text, textOrNull } from '@/lib/apiContract'

export const datasetImportJobsKey = (account: string | null) => ['dataset-imports', account] as const

export function datasetImportTask(raw: unknown) {
  const value = record(raw)
  const error = value.error == null ? null : record(value.error)
  return {
    taskId: text(value.taskId),
    filename: text(value.filename),
    status: text(value.status),
    stage: text(value.stage),
    processed: finiteNumber(value.processed),
    total: value.total == null ? null : finiteNumber(value.total),
    currentFile: textOrNull(value.currentFile),
    rowsWritten: value.rowsWritten == null ? 0 : finiteNumber(value.rowsWritten),
    rowsTotal: value.rowsTotal == null ? null : finiteNumber(value.rowsTotal),
    preferredVersion: textOrNull(value.preferredVersion),
    createdCount: finiteNumber(value.createdCount),
    versions: recordList(value.versions).map(rawVersion => {
      const item = record(rawVersion)
      return {
        version: text(item.version), project: textOrNull(item.project),
        dataset: text(item.dataset), records: finiteNumber(item.records),
      }
    }),
    error: error ? { code: text(error.code), message: text(error.message) } : null,
    createdAt: text(value.createdAt),
    legacy: value.legacy === true,
  }
}

export type DatasetImportTask = ReturnType<typeof datasetImportTask>

export function importIsActive(task: DatasetImportTask): boolean {
  return task.status === 'queued' || task.status === 'running'
}

export function importPercent(task: DatasetImportTask): number | null {
  if (task.status === 'completed') return 100
  if (!task.total) return null
  const current = task.rowsTotal ? Math.min(1, task.rowsWritten / task.rowsTotal) : 0
  return Math.min(100, Math.round(100 * (task.processed + current) / task.total))
}

const STAGES: Record<string, string> = {
  queued: '排队中', validating: '校验文件', importing: '写入数据', registering: '登记版本',
  completed: '已完成', failed: '导入失败', interrupted: '导入中断',
}

export function importStage(task: DatasetImportTask): string {
  return STAGES[importIsActive(task) ? task.stage : task.status] ?? '等待处理'
}

export async function startDatasetImport(file: File, options: { zipped: boolean; schema?: string; dataset?: string }) {
  const params = new URLSearchParams({ filename: file.name, format: options.zipped ? 'zip' : 'csv' })
  if (options.schema && !options.zipped) params.set('schema', options.schema)
  if (options.dataset && !options.zipped) params.set('dataset', options.dataset)
  return datasetImportTask(await apiRequest({
    path: `/api/v1/user/dataset-imports?${params}`,
    method: 'POST',
    rawBody: file,
    contentType: options.zipped ? 'application/zip' : 'text/csv',
  }))
}

export async function getDatasetImport(taskId: string, signal?: AbortSignal) {
  return datasetImportTask(await apiRequest({
    path: `/api/v1/user/dataset-imports/${encodeURIComponent(taskId)}`, method: 'GET', signal,
  }))
}

export function useDatasetImportJobs(account: string | null, enabled = true) {
  return useQuery({
    queryKey: datasetImportJobsKey(account),
    enabled: enabled && Boolean(account),
    queryFn: async ({ signal }) => {
      const body = record(await apiRequest({ path: '/api/v1/user/dataset-imports', method: 'GET', signal }))
      return recordList(body.tasks).map(datasetImportTask)
    },
    refetchInterval: query => query.state.data?.some(importIsActive) ? 2000 : 6000,
    retry: false,
  })
}
