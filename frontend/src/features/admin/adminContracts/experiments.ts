import { apiRequest } from '@/lib/apiClient'
import { finiteNumber, record, recordList, text, textList, textOrNull } from '@/lib/apiContract'
import { type Row, ADMIN_READ_TIMEOUT_MS } from './common'

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
  releaseStatus: 'qualified' | 'unqualified' | 'not-evaluated'
  releaseReportId: string | null
  releaseError: { code: string; message: string } | null
  releaseReport: Row | null
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
    releaseStatus: ['qualified', 'unqualified', 'not-evaluated'].includes(text(value.releaseStatus))
      ? text(value.releaseStatus) as ExperimentRun['releaseStatus'] : 'not-evaluated',
    releaseReportId: textOrNull(value.releaseReportId),
    releaseError: value.releaseError == null ? null : {
      code: text(record(value.releaseError).code),
      message: text(record(value.releaseError).message),
    },
    releaseReport: value.releaseReport == null ? null : record(value.releaseReport),
    promotable: value.promotable === true,
    locations: recordList(value.locations).map(experimentLocation),
  }
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
    timeoutMs: ADMIN_READ_TIMEOUT_MS,
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
    timeoutMs: ADMIN_READ_TIMEOUT_MS,
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
