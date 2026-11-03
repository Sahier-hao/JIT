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

export interface ExperimentRunLocation {
  candidateId: string
  artifactKey: string | null
  artifactState: 'complete' | 'invalid' | 'failed'
  manifestSha256: string | null
  reason: string | null
}

export interface ExperimentRun {
  candidateId: string
  displayName: string
  artifactKey: string | null
  artifactState: 'complete' | 'invalid' | 'failed'
  artifactStateReason: string | null
  manifestSha256: string | null
  artifactRunId: string | null
  runId: string | null
  modelId: string | null
  modelState: string | null
  registrationState: 'registered' | 'unregistered'
  enabled: boolean | null
  isDefault: boolean | null
  method: string | null
  name: string | null
  featureSchemaVersion: string | null
  datasetVersion: string | null
  metricSet: string | null
  metrics: Row
  trainingSeconds: number | null
  split: Row
  source: Row
  limitations: string[]
  serviceCompatibility: 'repository-analysis' | 'offline-only' | 'input-unsupported' | 'schema-incompatible'
  serviceCompatibilityReason: string | null
  promotable: boolean
  locations: ExperimentRunLocation[]
}

export interface ExperimentReport {
  artifactKey: string
  registrationEligible: false
  reason: string
}

export interface ExperimentRunPage {
  runs: ExperimentRun[]
  reports: ExperimentReport[]
  total: number
  limit: number
  offset: number
}

export interface ExperimentPromotionItem {
  candidateId: string
  status: 'registered' | 'reused' | 'already-registered' | 'failed'
  modelId: string | null
  runId: string | null
  code: string | null
  message: string | null
}

export interface ModelReadiness {
  ready: boolean
  completeArtifacts: number
  unregisteredExperiments: number
  completeUnregisteredExperiments: number
  invalidArtifacts: number
  registeredModels: number
  readyModels: number
  repositorySelectableModels: number
  userSelectableModels: number
  invalidModels: number
  artifactInvalidModels: number
  dependencyUnavailableModels: number
  disabledModels: number
  incompatibleModels: number
  defaultModelId: string | null
  defaultAvailable: boolean
  reportOnlyArtifacts: number
  issues: { code: string; message: string }[]
}

export type CoverageState =
  | 'missing' | 'failed' | 'invalid' | 'offline-only' | 'input-unsupported'
  | 'incompatible' | 'complete-unregistered' | 'registered-ready' | 'registered-unavailable'

export interface ModelCoverageCell {
  method: string
  name: string
  category: string | null
  state: CoverageState
  reason: string | null
  runId: string | null
  modelId: string | null
  modelState: string | null
  enabled: boolean | null
  metrics: Row
}

export interface ModelCoverageDataset {
  datasetKey: string
  dataset: string
  datasetVersion: string
  schema: string
  metricSet: string | null
  source: 'suite' | 'artifacts'
  suitePath: string | null
  suiteStatus: string | null
  methods: ModelCoverageCell[]
  counts: Record<string, number>
}

export interface ModelPackageImportItem {
  artifactRunId: string | null
  sourceModelId: string | null
  artifactKey: string | null
  status: 'registered' | 'reused' | 'already-registered' | 'conflict' | 'failed'
  modelId: string | null
  runId: string | null
  code: string | null
  message: string | null
}

export interface ModelPackageImport {
  importId: string
  packageSha256: string
  packageVersion: number
  packageName: string
  status: 'completed' | 'partial' | 'failed'
  modelCount: number
  registeredCount: number
  reusedCount: number
  alreadyRegisteredCount: number
  conflictCount: number
  failedCount: number
  code: string | null
  message: string | null
  createdAt: string
  items: ModelPackageImportItem[]
}

export interface ModelCoveragePage {
  datasets: ModelCoverageDataset[]
  total: number
  limit: number
  offset: number
  latestImport: ModelPackageImport | null
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

export async function fetchAdminModels(signal?: AbortSignal): Promise<{ models: AdminModel[]; methods: Row[]; candidates: Row[]; readiness: ModelReadiness }> {
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
    readiness: modelReadiness(catalog.readiness),
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

function experimentLocation(raw: unknown): ExperimentRunLocation {
  const value = record(raw)
  const state = text(value.artifactState)
  if (!['complete', 'invalid', 'failed'].includes(state)) throw new Error('实验产物状态无效')
  return {
    candidateId: text(value.candidateId),
    artifactKey: textOrNull(value.artifactKey),
    artifactState: state as ExperimentRunLocation['artifactState'],
    manifestSha256: textOrNull(value.manifestSha256),
    reason: textOrNull(value.reason),
  }
}

function experimentRun(raw: unknown): ExperimentRun {
  const value = record(raw)
  const artifactState = text(value.artifactState)
  const registrationState = text(value.registrationState)
  const compatibility = text(value.serviceCompatibility)
  if (!['complete', 'invalid', 'failed'].includes(artifactState)) throw new Error('实验产物状态无效')
  if (!['registered', 'unregistered'].includes(registrationState)) throw new Error('实验登记状态无效')
  if (!['repository-analysis', 'offline-only', 'input-unsupported', 'schema-incompatible'].includes(compatibility)) throw new Error('实验兼容状态无效')
  return {
    candidateId: text(value.candidateId),
    displayName: text(value.displayName),
    artifactKey: textOrNull(value.artifactKey),
    artifactState: artifactState as ExperimentRun['artifactState'],
    artifactStateReason: textOrNull(value.artifactStateReason),
    manifestSha256: textOrNull(value.manifestSha256),
    artifactRunId: textOrNull(value.artifactRunId),
    runId: textOrNull(value.runId),
    modelId: textOrNull(value.modelId),
    modelState: textOrNull(value.modelState),
    registrationState: registrationState as ExperimentRun['registrationState'],
    enabled: typeof value.enabled === 'boolean' ? value.enabled : null,
    isDefault: typeof value.isDefault === 'boolean' ? value.isDefault : null,
    method: textOrNull(value.method),
    name: textOrNull(value.name),
    featureSchemaVersion: textOrNull(value.featureSchemaVersion),
    datasetVersion: textOrNull(value.datasetVersion),
    metricSet: textOrNull(value.metricSet),
    metrics: record(value.metrics),
    trainingSeconds: typeof value.trainingSeconds === 'number' ? finiteNumber(value.trainingSeconds) : null,
    split: record(value.split),
    source: record(value.source),
    limitations: textList(value.limitations),
    serviceCompatibility: compatibility as ExperimentRun['serviceCompatibility'],
    serviceCompatibilityReason: textOrNull(value.serviceCompatibilityReason),
    promotable: value.promotable === true,
    locations: recordList(value.locations).map(experimentLocation),
  }
}

function modelReadiness(raw: unknown): ModelReadiness {
  const value = record(raw)
  const unregistered = finiteNumber(value.unregisteredExperiments)
  const selectable = finiteNumber(value.repositorySelectableModels)
  return {
    ready: value.ready === true,
    completeArtifacts: finiteNumber(value.completeArtifacts),
    unregisteredExperiments: unregistered,
    completeUnregisteredExperiments: typeof value.completeUnregisteredExperiments === 'number'
      ? finiteNumber(value.completeUnregisteredExperiments) : unregistered,
    invalidArtifacts: typeof value.invalidArtifacts === 'number' ? finiteNumber(value.invalidArtifacts) : 0,
    registeredModels: finiteNumber(value.registeredModels),
    readyModels: finiteNumber(value.readyModels),
    repositorySelectableModels: selectable,
    userSelectableModels: typeof value.userSelectableModels === 'number'
      ? finiteNumber(value.userSelectableModels) : selectable,
    invalidModels: typeof value.invalidModels === 'number' ? finiteNumber(value.invalidModels) : 0,
    artifactInvalidModels: typeof value.artifactInvalidModels === 'number' ? finiteNumber(value.artifactInvalidModels) : 0,
    dependencyUnavailableModels: typeof value.dependencyUnavailableModels === 'number'
      ? finiteNumber(value.dependencyUnavailableModels) : 0,
    disabledModels: typeof value.disabledModels === 'number' ? finiteNumber(value.disabledModels) : 0,
    incompatibleModels: typeof value.incompatibleModels === 'number' ? finiteNumber(value.incompatibleModels) : 0,
    defaultModelId: textOrNull(value.defaultModelId),
    defaultAvailable: value.defaultAvailable === true,
    reportOnlyArtifacts: finiteNumber(value.reportOnlyArtifacts),
    issues: recordList(value.issues).map(item => ({ code: text(item.code), message: text(item.message) })),
  }
}

const COVERAGE_STATES: readonly CoverageState[] = [
  'missing', 'failed', 'invalid', 'offline-only', 'input-unsupported',
  'incompatible', 'complete-unregistered', 'registered-ready', 'registered-unavailable',
]
const IMPORT_STATUSES = ['registered', 'reused', 'already-registered', 'conflict', 'failed'] as const

function coverageCell(raw: unknown): ModelCoverageCell {
  const value = record(raw)
  const state = text(value.state)
  if (!(COVERAGE_STATES as readonly string[]).includes(state)) throw new Error('训练覆盖状态无效')
  return {
    method: text(value.method),
    name: text(value.name),
    category: textOrNull(value.category),
    state: state as CoverageState,
    reason: textOrNull(value.reason),
    runId: textOrNull(value.runId),
    modelId: textOrNull(value.modelId),
    modelState: textOrNull(value.modelState),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : null,
    metrics: record(value.metrics),
  }
}

function coverageDataset(raw: unknown): ModelCoverageDataset {
  const value = record(raw)
  const source = text(value.source)
  if (!['suite', 'artifacts'].includes(source)) throw new Error('训练覆盖来源无效')
  return {
    datasetKey: text(value.datasetKey),
    dataset: text(value.dataset),
    datasetVersion: text(value.datasetVersion),
    schema: text(value.schema),
    metricSet: textOrNull(value.metricSet),
    source: source as ModelCoverageDataset['source'],
    suitePath: textOrNull(value.suitePath),
    suiteStatus: textOrNull(value.suiteStatus),
    methods: recordList(value.methods).map(coverageCell),
    counts: Object.fromEntries(Object.entries(record(value.counts)).map(([key, count]) => [key, finiteNumber(count)])),
  }
}

function packageImportItem(raw: unknown): ModelPackageImportItem {
  const value = record(raw)
  const status = text(value.status)
  if (!(IMPORT_STATUSES as readonly string[]).includes(status)) throw new Error('模型包导入条目状态无效')
  return {
    artifactRunId: textOrNull(value.artifactRunId),
    sourceModelId: textOrNull(value.sourceModelId),
    artifactKey: textOrNull(value.artifactKey),
    status: status as ModelPackageImportItem['status'],
    modelId: textOrNull(value.modelId),
    runId: textOrNull(value.runId),
    code: textOrNull(value.code),
    message: textOrNull(value.message),
  }
}

function packageImport(raw: unknown): ModelPackageImport {
  const value = record(raw)
  const status = text(value.status)
  if (!['completed', 'partial', 'failed'].includes(status)) throw new Error('模型包导入状态无效')
  return {
    importId: text(value.importId),
    packageSha256: text(value.packageSha256),
    packageVersion: finiteNumber(value.packageVersion),
    packageName: text(value.packageName),
    status: status as ModelPackageImport['status'],
    modelCount: finiteNumber(value.modelCount),
    registeredCount: finiteNumber(value.registeredCount),
    reusedCount: finiteNumber(value.reusedCount),
    alreadyRegisteredCount: finiteNumber(value.alreadyRegisteredCount),
    conflictCount: finiteNumber(value.conflictCount),
    failedCount: finiteNumber(value.failedCount),
    code: textOrNull(value.code),
    message: textOrNull(value.message),
    createdAt: text(value.createdAt),
    items: recordList(value.items).map(packageImportItem),
  }
}

export async function fetchModelCoverage(signal?: AbortSignal): Promise<ModelCoveragePage> {
  const value = record(await apiRequest({ path: '/api/v1/models/coverage?limit=100', method: 'GET', signal }))
  return {
    datasets: recordList(value.datasets).map(coverageDataset),
    total: finiteNumber(value.total),
    limit: finiteNumber(value.limit),
    offset: finiteNumber(value.offset),
    latestImport: value.latestImport === null ? null : packageImport(value.latestImport),
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

export async function fetchExperimentRuns(options: {
  registrationState?: string
  compatibility?: string
  artifactState?: string
  limit?: number
  offset?: number
  signal?: AbortSignal
} = {}): Promise<ExperimentRunPage> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  })
  if (options.registrationState) params.set('registrationState', options.registrationState)
  if (options.compatibility) params.set('compatibility', options.compatibility)
  if (options.artifactState) params.set('artifactState', options.artifactState)
  const body = record(await apiRequest({
    path: `/api/v1/experiment-runs?${params}`,
    method: 'GET',
    signal: options.signal,
  }))
  return {
    runs: recordList(body.runs).map(experimentRun),
    reports: recordList(body.reports).map(item => {
      if (item.registrationEligible !== false) throw new Error('报告登记状态无效')
      return { artifactKey: text(item.artifactKey), registrationEligible: false, reason: text(item.reason) }
    }),
    total: finiteNumber(body.total),
    limit: finiteNumber(body.limit),
    offset: finiteNumber(body.offset),
  }
}

export async function fetchExperimentRun(candidateId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  return experimentRun(await apiRequest({
    path: `/api/v1/experiment-runs/${encodeURIComponent(candidateId)}`,
    method: 'GET',
    signal,
  }))
}

export async function promoteExperimentRuns(items: { candidateId: string; expectedManifestSha256: string }[]): Promise<{
  items: ExperimentPromotionItem[]
  registered: number
  failed: number
}> {
  const body = record(await apiRequest({
    path: '/api/v1/experiment-runs/promote',
    method: 'POST',
    body: { items },
  }))
  return {
    items: recordList(body.items).map(raw => {
      const value = record(raw)
      const status = text(value.status)
      if (!['registered', 'reused', 'already-registered', 'failed'].includes(status)) throw new Error('登记结果状态无效')
      return {
        candidateId: text(value.candidateId),
        status: status as ExperimentPromotionItem['status'],
        modelId: textOrNull(value.modelId),
        runId: textOrNull(value.runId),
        code: textOrNull(value.code),
        message: textOrNull(value.message),
      }
    }),
    registered: finiteNumber(body.registered),
    failed: finiteNumber(body.failed),
  }
}
