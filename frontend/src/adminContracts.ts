import { apiRequest } from './apiClient'
import { finiteNumber, record, recordList, text, textList, textOrNull } from './apiContract'

export type Row = Record<string, unknown>

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
  limitations: string[]
}

export interface AdminModel {
  modelId: string
  name: string
  method: string
  state: string
  enabled: boolean
  isDefault: boolean
  featureSchemaVersion: string
  runId: string
  artifactRunId: string
  artifactDatasetVersion: string
  artifactKey?: string
  metrics?: Row
  trainingSeconds?: number | null
  metricSet?: string | null
  threshold?: number
  source?: Row
  split?: Row
  limitations?: string[]
}

export interface TrainingTask {
  taskId: string
  datasetVersion: string
  datasetManifest: string
  manifestSha256: string
  method: string
  metricSet: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
  stage: string
  error: { code: string; message: string } | null
  parentTaskId: string | null
  createdBy: string
  requestId: string | null
  artifactKey: string | null
  artifactRunId: string | null
  runId: string | null
  modelId: string | null
  featureSchemaVersion: string | null
  metrics: Row | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  deadlineAt: string | null
  cancelRequestedAt: string | null
  completedAt: string | null
  queuePosition: number | null
}

export interface TrainingTaskPage {
  tasks: TrainingTask[]
  total: number
  limit: number
  offset: number
}

const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const
export const ACTIVE_TASK_STATUSES: readonly string[] = ['queued', 'running']

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
    limitations: textList(value.limitations),
  }
}

export async function fetchAdminDatasets(signal?: AbortSignal): Promise<AdminDatasetVersion[]> {
  const body = record(await apiRequest({ path: '/api/v1/datasets', method: 'GET', signal }))
  return recordList(body.datasets).flatMap(group => {
    const value = record(group)
    const dataset = text(value.dataset)
    return recordList(value.versions).map(version => datasetVersion(version, dataset))
  })
}

export async function fetchAdminModels(signal?: AbortSignal): Promise<{ models: AdminModel[]; methods: Row[]; candidates: Row[] }> {
  const [catalogBody, candidateBody] = await Promise.all([
    apiRequest({ path: '/api/v1/models', method: 'GET', signal }),
    apiRequest({ path: '/api/v1/model-candidates', method: 'GET', signal }),
  ])
  const catalog = record(catalogBody)
  return {
    models: recordList(catalog.models).map(raw => {
      const value = record(raw)
      return {
        modelId: text(value.modelId),
        name: text(value.name),
        method: typeof value.method === 'string' ? value.method : '未提供',
        state: text(value.state),
        enabled: value.enabled === true,
        isDefault: value.isDefault === true,
        featureSchemaVersion: text(value.featureSchemaVersion),
        runId: typeof value.runId === 'string' ? value.runId : '',
        artifactRunId: typeof value.artifactRunId === 'string' ? value.artifactRunId : '',
        artifactDatasetVersion: typeof value.artifactDatasetVersion === 'string' ? value.artifactDatasetVersion : '',
        limitations: Array.isArray(value.limitations) ? textList(value.limitations) : [],
      }
    }),
    methods: recordList(catalog.methods),
    candidates: recordList(record(candidateBody).candidates),
  }
}

export async function fetchAdminModel(modelId: string, signal?: AbortSignal): Promise<AdminModel> {
  const body = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}`, method: 'GET', signal }))
  return {
    modelId: text(body.modelId),
    name: text(body.name),
    method: text(body.method),
    state: text(body.state),
    enabled: body.enabled === true,
    isDefault: body.isDefault === true,
    featureSchemaVersion: text(body.featureSchemaVersion),
    runId: text(body.runId),
    artifactRunId: text(body.artifactRunId),
    artifactDatasetVersion: text(body.artifactDatasetVersion),
    artifactKey: text(body.artifactKey),
    metrics: record(body.metrics),
    trainingSeconds: typeof body.trainingSeconds === 'number' ? finiteNumber(body.trainingSeconds) : null,
    metricSet: textOrNull(body.metricSet),
    threshold: finiteNumber(body.threshold),
    source: record(body.source),
    split: record(body.split),
    limitations: textList(body.limitations),
  }
}

function trainingTask(raw: unknown): TrainingTask {
  const value = record(raw)
  const status = text(value.status)
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new Error('训练任务状态无效')
  const error = value.error === null ? null : record(value.error)
  return {
    taskId: text(value.taskId),
    datasetVersion: text(value.datasetVersion),
    datasetManifest: text(value.datasetManifest),
    manifestSha256: text(value.manifestSha256),
    method: text(value.method),
    metricSet: text(value.metricSet),
    status: status as TrainingTask['status'],
    stage: text(value.stage),
    error: error ? { code: text(error.code), message: text(error.message) } : null,
    parentTaskId: textOrNull(value.parentTaskId),
    createdBy: text(value.createdBy),
    requestId: textOrNull(value.requestId),
    artifactKey: textOrNull(value.artifactKey),
    artifactRunId: textOrNull(value.artifactRunId),
    runId: textOrNull(value.runId),
    modelId: textOrNull(value.modelId),
    featureSchemaVersion: textOrNull(value.featureSchemaVersion),
    metrics: value.metrics === null ? null : record(value.metrics),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    startedAt: textOrNull(value.startedAt),
    deadlineAt: textOrNull(value.deadlineAt),
    cancelRequestedAt: textOrNull(value.cancelRequestedAt),
    completedAt: textOrNull(value.completedAt),
    queuePosition: value.queuePosition === null ? null : finiteNumber(value.queuePosition),
  }
}

export async function fetchTrainingTasks(limit = 20, offset = 0, signal?: AbortSignal): Promise<TrainingTaskPage> {
  const body = record(await apiRequest({ path: `/api/v1/training-tasks?limit=${limit}&offset=${offset}`, method: 'GET', signal }))
  return {
    tasks: recordList(body.tasks).map(trainingTask),
    total: finiteNumber(body.total),
    limit: finiteNumber(body.limit),
    offset: finiteNumber(body.offset),
  }
}

export async function fetchTrainingTask(taskId: string, signal?: AbortSignal): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}`, method: 'GET', signal }))
}

export async function createTrainingTask(datasetVersion: string, method: string, metricSet: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({
    path: '/api/v1/training-tasks',
    method: 'POST',
    body: { datasetVersion, method, metricSet },
  }))
}

export async function cancelTrainingTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}/cancel`, method: 'POST' }))
}

export async function retryTrainingTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}/retry`, method: 'POST', body: {} }))
}
