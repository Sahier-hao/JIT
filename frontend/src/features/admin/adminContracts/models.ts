import { apiRequest } from '@/lib/apiClient'
import { finiteNumber, record, recordList, text, textList, textOrNull } from '@/lib/apiContract'
import { parseModelCard, type ModelCard } from '@/features/models/modelCardClient'
import { type Row, ADMIN_READ_TIMEOUT_MS } from './common'

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
  parameters?: Row | null
  parameterContract?: string | null
  ownerUserId?: string | null
  trainingSeconds?: number | null
  metricSet?: string | null
  threshold?: number
  source?: Row
  split?: Row
  limitations?: string[]
  card?: ModelCard
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


export async function fetchAdminModels(signal?: AbortSignal): Promise<{ models: AdminModel[]; methods: Row[]; candidates: Row[]; readiness: ModelReadiness }> {
  const [catalogBody, candidateBody] = await Promise.all([
    apiRequest({ path: '/api/v1/models', method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }),
    apiRequest({ path: '/api/v1/model-candidates', method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }),
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
  const body = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}`, method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
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
    parameters: body.parameters == null ? null : record(body.parameters),
    parameterContract: textOrNull(body.parameterContract),
    ownerUserId: textOrNull(body.ownerUserId),
    trainingSeconds: typeof body.trainingSeconds === 'number' ? finiteNumber(body.trainingSeconds) : null,
    metricSet: textOrNull(body.metricSet),
    threshold: finiteNumber(body.threshold),
    source: record(body.source),
    split: record(body.split),
    limitations: textList(body.limitations),
    card: body.card == null ? undefined : parseModelCard(body.card),
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
  const value = record(await apiRequest({ path: '/api/v1/models/coverage?limit=100', method: 'GET', signal, timeoutMs: ADMIN_READ_TIMEOUT_MS }))
  return {
    datasets: recordList(value.datasets).map(coverageDataset),
    total: finiteNumber(value.total),
    limit: finiteNumber(value.limit),
    offset: finiteNumber(value.offset),
    latestImport: value.latestImport === null ? null : packageImport(value.latestImport),
  }
}
