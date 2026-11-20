import { apiRequest } from '@/lib/apiClient'
import { finiteNumber, record, recordList, text, textList, textOrNull } from '@/lib/apiContract'
import { type Row, ADMIN_READ_TIMEOUT_MS, TASK_STATUSES } from './common'

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
  metricsByPartition: Row | null
  split: Row | null
  splitPreset: string
  splitPolicy: Row | null
  maturityPolicy: 'mature-only' | 'include-immature' | 'legacy-unrecorded'
  maturity: Row | null
  releasePolicy: string | null
  releaseStatus: 'qualified' | 'unqualified' | 'not-evaluated'
  releaseReportId: string | null
  release: Row | null
  splitRule: string | null
  dataScale: Row | null
  trainingPerformance: Row | null
  experimentId: string | null
  ownerUserId?: string | null
  parameters: Row | null
  trainingHistory: {
    unit: string
    epochs: number
    complete: boolean
    method?: string | null
    entries: { epoch: number; trainLoss: number | null; trainEvalLoss?: number | null; validationLoss?: number | null; seconds: number }[]
  } | null
  classPolicy: Row | null
  classPolicySummary: Row | null
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


function trainingHistory(raw: unknown): TrainingTask['trainingHistory'] {
  if (raw == null) return null
  const value = record(raw)
  const entries = recordList(value.entries).map(entry => ({
    epoch: finiteNumber(entry.epoch),
    trainLoss: entry.trainLoss == null ? null : finiteNumber(entry.trainLoss),
    trainEvalLoss: entry.trainEvalLoss == null ? null : finiteNumber(entry.trainEvalLoss),
    validationLoss: entry.validationLoss == null ? null : finiteNumber(entry.validationLoss),
    seconds: finiteNumber(entry.seconds),
  }))
  return {
    unit: text(value.unit), epochs: finiteNumber(value.epochs),
    complete: value.complete === true, method: textOrNull(value.method), entries,
  }
}

export function trainingTask(raw: unknown): TrainingTask {
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
    metricsByPartition: value.metricsByPartition == null ? null : record(value.metricsByPartition),
    split: value.split == null ? null : record(value.split),
    splitPreset: textOrNull(value.splitPreset) ?? 'temporal-70-15-15',
    splitPolicy: value.splitPolicy == null ? null : record(value.splitPolicy),
    maturityPolicy: ['mature-only', 'include-immature', 'legacy-unrecorded'].includes(value.maturityPolicy as string)
      ? value.maturityPolicy as TrainingTask['maturityPolicy'] : 'mature-only',
    maturity: value.maturity == null ? null : record(value.maturity),
    releasePolicy: textOrNull(value.releasePolicy),
    releaseStatus: ['qualified', 'unqualified', 'not-evaluated'].includes(value.releaseStatus as string)
      ? value.releaseStatus as TrainingTask['releaseStatus'] : 'not-evaluated',
    releaseReportId: textOrNull(value.releaseReportId),
    release: value.release == null ? null : record(value.release),
    splitRule: textOrNull(value.splitRule),
    dataScale: value.dataScale == null ? null : record(value.dataScale),
    trainingPerformance: value.trainingPerformance == null ? null : record(value.trainingPerformance),
    experimentId: textOrNull(value.experimentId),
    ownerUserId: textOrNull(value.ownerUserId),
    parameters: value.parameters == null ? null : record(value.parameters),
    trainingHistory: trainingHistory(value.trainingHistory),
    classPolicy: value.classPolicy == null ? null : record(value.classPolicy),
    classPolicySummary: value.classPolicySummary == null ? null : record(value.classPolicySummary),
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
  const body = record(await apiRequest({ path: `/api/v1/training-tasks?limit=${limit}&offset=${offset}`, method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
  return {
    tasks: recordList(body.tasks).map(trainingTask),
    total: finiteNumber(body.total),
    limit: finiteNumber(body.limit),
    offset: finiteNumber(body.offset),
  }
}

export async function fetchTrainingTask(taskId: string, signal?: AbortSignal): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}`, method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
}

export async function createTrainingTask(datasetVersion: string, method: string, metricSet: string,
                                          classPolicy?: { kind: 'weights' | 'sample'; seed?: number },
                                          splitPreset = 'temporal-70-15-15',
                                          maturityPolicy: 'mature-only' | 'include-immature' = 'mature-only'): Promise<TrainingTask> {
  return trainingTask(await apiRequest({
    path: '/api/v1/training-tasks',
    method: 'POST',
    body: { datasetVersion, method, metricSet, splitPreset, maturityPolicy, ...(classPolicy ? { classPolicy } : {}) },
  }))
}

export async function cancelTrainingTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}/cancel`, method: 'POST' }))
}

export async function retryTrainingTask(taskId: string): Promise<TrainingTask> {
  return trainingTask(await apiRequest({ path: `/api/v1/training-tasks/${encodeURIComponent(taskId)}/retry`, method: 'POST', body: {} }))
}

export type TrainingExperimentStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'partial' | 'empty'

export interface TrainingExperiment {
  experimentId: string
  datasetVersion: string
  datasetManifest: string
  manifestSha256: string
  metricSet: string
  splitPreset: string
  classPolicy: Row | null
  seed: number
  requestId: string | null
  createdBy: string
  ownerUserId: string | null
  createdAt: string
  status: TrainingExperimentStatus
  statusCounts: Record<string, number>
  tasks: TrainingTask[]
}

export interface TrainingExperimentMethodResult {
  taskId: string
  method: string
  methodName: string
  category: string
  parameters: Row | null
  status: TrainingTask['status']
  stage: string
  error: { code: string; message: string } | null
  metrics: Row | null
  metricsByPartition: Row | null
  trainingSeconds: number | null
  runId: string | null
  modelId: string | null
  manifestSha256: string
  splitPreset: string
  classPolicy: Row | null
  metricSet: string
}

export interface TrainingExperimentComparison {
  format: string
  experimentId: string
  datasetVersion: string
  manifestSha256: string
  metricSet: string
  splitPreset: string
  classPolicy: Row | null
  seed: number
  status: TrainingExperimentStatus
  comparable: boolean
  notes: string[]
  methods: TrainingExperimentMethodResult[]
}

export function trainingExperiment(raw: unknown): TrainingExperiment {
  const value = record(raw)
  const status = text(value.status)
  const statusCounts: Record<string, number> = {}
  if (value.statusCounts != null) {
    for (const [key, count] of Object.entries(record(value.statusCounts))) {
      statusCounts[key] = finiteNumber(count)
    }
  }
  return {
    experimentId: text(value.experimentId),
    datasetVersion: text(value.datasetVersion),
    datasetManifest: text(value.datasetManifest),
    manifestSha256: text(value.manifestSha256),
    metricSet: text(value.metricSet),
    splitPreset: text(value.splitPreset),
    classPolicy: value.classPolicy == null ? null : record(value.classPolicy),
    seed: finiteNumber(value.seed),
    requestId: textOrNull(value.requestId),
    createdBy: text(value.createdBy),
    ownerUserId: textOrNull(value.ownerUserId),
    createdAt: text(value.createdAt),
    status: status as TrainingExperimentStatus,
    statusCounts,
    tasks: recordList(value.tasks).map(trainingTask),
  }
}

export function experimentMethodResult(raw: unknown): TrainingExperimentMethodResult {
  const value = record(raw)
  const error = value.error == null ? null : record(value.error)
  return {
    taskId: text(value.taskId),
    method: text(value.method),
    methodName: text(value.methodName),
    category: text(value.category),
    parameters: value.parameters == null ? null : record(value.parameters),
    status: text(value.status) as TrainingTask['status'],
    stage: text(value.stage),
    error: error ? { code: text(error.code), message: text(error.message) } : null,
    metrics: value.metrics == null ? null : record(value.metrics),
    metricsByPartition: value.metricsByPartition == null ? null : record(value.metricsByPartition),
    trainingSeconds: value.trainingSeconds == null ? null : finiteNumber(value.trainingSeconds),
    runId: textOrNull(value.runId),
    modelId: textOrNull(value.modelId),
    manifestSha256: text(value.manifestSha256),
    splitPreset: text(value.splitPreset),
    classPolicy: value.classPolicy == null ? null : record(value.classPolicy),
    metricSet: text(value.metricSet),
  }
}

export async function createTrainingExperiment(options: {
  datasetVersion: string
  methods: { method: string; params?: Row }[]
  metricSet?: string
  classPolicy?: { kind: 'weights' | 'sample'; seed?: number }
  splitPreset?: string
  maturityPolicy?: 'mature-only' | 'include-immature'
}, signal?: AbortSignal): Promise<TrainingExperiment> {
  return trainingExperiment(await apiRequest({
    path: '/api/v1/training-experiments', method: 'POST', signal,
    body: {
      datasetVersion: options.datasetVersion,
      metricSet: options.metricSet ?? 'metric-set-v2',
      splitPreset: options.splitPreset ?? 'temporal-70-15-15',
      maturityPolicy: options.maturityPolicy ?? 'mature-only',
      methods: options.methods,
      ...(options.classPolicy ? { classPolicy: options.classPolicy } : {}),
    },
  }))
}

export async function fetchTrainingExperiment(experimentId: string, signal?: AbortSignal): Promise<TrainingExperiment> {
  return trainingExperiment(await apiRequest({
    path: `/api/v1/training-experiments/${encodeURIComponent(experimentId)}`, method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS,
  }))
}

export async function fetchTrainingExperimentComparison(experimentId: string, signal?: AbortSignal): Promise<TrainingExperimentComparison> {
  const body = record(await apiRequest({
    path: `/api/v1/training-experiments/${encodeURIComponent(experimentId)}/comparison`,
    method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS,
  }))
  return {
    format: text(body.format),
    experimentId: text(body.experimentId),
    datasetVersion: text(body.datasetVersion),
    manifestSha256: text(body.manifestSha256),
    metricSet: text(body.metricSet),
    splitPreset: text(body.splitPreset),
    classPolicy: body.classPolicy == null ? null : record(body.classPolicy),
    seed: finiteNumber(body.seed),
    status: text(body.status) as TrainingExperimentStatus,
    comparable: body.comparable === true,
    notes: textList(body.notes),
    methods: recordList(body.methods).map(experimentMethodResult),
  }
}

