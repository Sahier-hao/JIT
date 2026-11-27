import { apiRequest } from '@/lib/apiClient'
import {
  contractFailed, finiteNumber, record, recordList, riskNumber,
  text, textOrNull,
} from '@/lib/apiContract'

export interface PredictionModel {
  modelId: string
  name: string
  method: string | null
  runId: string | null
  featureSchemaVersion: string
  artifactDatasetVersion: string | null
  isDefault: boolean
  mine: boolean
  shared: boolean
}

export interface PredictionModelList {
  models: PredictionModel[]
  maxRecords: number
}

export interface PredictionCounts {
  records: number
  positives: number
  negatives: number
  flagged: number
}

export interface ThresholdPreview {
  thresholds: number[]
  positives: number
  negatives: number
  truePositives: number[]
  falsePositives: number[]
}

export interface EvaluationSummary {
  format: 'model-evaluation-v1'
  source: 'prediction-batch'
  mode: 'formal' | 'exploratory'
  formalAvailable: boolean
  formalUnavailableReason: string | null
  partition: { kind: 'test' | 'batch'; memberSha256: string | null; labelSnapshot: boolean }
  labelPolicy: {
    version: string
    included: string[]
    excludedCounts: Record<string, number>
  } | null
  sampleCounts: { included: number; positives: number; negatives: number; excluded: number } | null
  thresholdPreview: ThresholdPreview
}

export interface PredictionBatch {
  batchId: string
  datasetVersion: string
  dataset: string
  model: PredictionModel
  threshold: number
  counts: PredictionCounts
  labelStatusCounts: Record<string, number>
  thresholdPreview: ThresholdPreview
  evaluation: EvaluationSummary | null
  explanationCoverage: { method: string; limit: number; recorded: number; failed: number }
  featureNames: string[]
  createdAt: string
  limitations: string[]
}

export interface PredictionBatchSummary {
  batchId: string
  datasetVersion: string
  dataset: string
  model: PredictionModel
  threshold: number
  counts: PredictionCounts
  labelStatusCounts: Record<string, number>
  createdAt: string
}

export interface PredictionExplanationItem {
  feature: string
  value: number
  baseline: number
  delta: number
  direction: 'increases' | 'decreases'
}

export interface PredictionRecord {
  predictionId: string
  recordId: string
  authorTime: string | null
  label: 0 | 1
  labelStatus: string
  risk: number
  features: Record<string, number>
  explanation: {
    status: string
    method: string
    items: PredictionExplanationItem[]
    summary: string
  } | null
}

export interface PredictionBatchDetail extends PredictionBatch {
  records: PredictionRecord[]
  limit: number
  offset: number
  sort: 'risk' | 'time'
}

function model(raw: unknown): PredictionModel {
  const value = record(raw)
  return {
    modelId: text(value.modelId),
    name: text(value.name),
    method: textOrNull(value.method),
    runId: textOrNull(value.runId),
    featureSchemaVersion: text(value.featureSchemaVersion),
    artifactDatasetVersion: textOrNull(value.artifactDatasetVersion),
    isDefault: value.isDefault === true,
    mine: value.mine === true,
    shared: value.shared === true,
  }
}

function counts(raw: unknown): PredictionCounts {
  const value = record(raw)
  return {
    records: finiteNumber(value.records),
    positives: finiteNumber(value.positives),
    negatives: finiteNumber(value.negatives),
    flagged: finiteNumber(value.flagged),
  }
}

function numberList(value: unknown, name: string): number[] {
  if (!Array.isArray(value) || value.length !== 101) contractFailed(`${name} 阈值序列无效`)
  return value.map(item => {
    const parsed = finiteNumber(item)
    if (!Number.isInteger(parsed) || parsed < 0) contractFailed(`${name} 阈值计数无效`)
    return parsed
  })
}

function thresholdPreview(raw: unknown): ThresholdPreview {
  const value = record(raw)
  const thresholds = Array.isArray(value.thresholds)
    ? value.thresholds.map(item => finiteNumber(item)) : []
  if (thresholds.length !== 101 || thresholds.some((item, index) => Math.abs(item - index / 100) > 1e-9)) {
    contractFailed('阈值序列与 0–1 步长约定不一致')
  }
  return {
    thresholds,
    positives: finiteNumber(value.positives),
    negatives: finiteNumber(value.negatives),
    truePositives: numberList(value.truePositives, 'truePositives'),
    falsePositives: numberList(value.falsePositives, 'falsePositives'),
  }
}

function batch(raw: unknown): PredictionBatch {
  const value = record(raw)
  const status = value.labelStatusCounts == null ? {} : record(value.labelStatusCounts)
  const coverage = record(value.explanationCoverage)
  const evaluation = value.evaluation == null ? null : (() => {
    const item = record(value.evaluation)
    const partition = record(item.partition)
    const policy = item.labelPolicy == null ? null : record(item.labelPolicy)
    const samples = item.sampleCounts == null ? null : record(item.sampleCounts)
    return {
      format: 'model-evaluation-v1' as const,
      source: 'prediction-batch' as const,
      mode: item.mode === 'formal' ? 'formal' as const : 'exploratory' as const,
      formalAvailable: item.formalAvailable === true,
      formalUnavailableReason: textOrNull(item.formalUnavailableReason),
      partition: {
        kind: partition.kind === 'test' ? 'test' as const : 'batch' as const,
        memberSha256: textOrNull(partition.memberSha256),
        labelSnapshot: partition.labelSnapshot === true,
      },
      labelPolicy: policy ? {
        version: text(policy.version),
        included: Array.isArray(policy.included) ? policy.included.map(item => text(item)) : [],
        excludedCounts: Object.fromEntries(
          Object.entries(record(policy.excludedCounts)).map(([key, item]) => [key, finiteNumber(item)]),
        ),
      } : null,
      sampleCounts: samples ? {
        included: finiteNumber(samples.included),
        positives: finiteNumber(samples.positives),
        negatives: finiteNumber(samples.negatives),
        excluded: finiteNumber(samples.excluded),
      } : null,
      thresholdPreview: thresholdPreview(item.thresholdPreview),
    }
  })()
  return {
    batchId: text(value.batchId),
    datasetVersion: text(value.datasetVersion),
    dataset: text(value.dataset),
    model: model(value.model),
    threshold: riskNumber(value.threshold),
    counts: counts(value.counts),
    labelStatusCounts: Object.fromEntries(
      Object.entries(status).map(([key, item]) => [key, finiteNumber(item)]),
    ),
    thresholdPreview: thresholdPreview(value.thresholdPreview),
    evaluation,
    explanationCoverage: {
      method: text(coverage.method),
      limit: finiteNumber(coverage.limit),
      recorded: finiteNumber(coverage.recorded),
      failed: finiteNumber(coverage.failed),
    },
    featureNames: Array.isArray(value.featureNames)
      ? value.featureNames.map(item => text(item)) : contractFailed('特征字段缺失'),
    createdAt: text(value.createdAt),
    limitations: Array.isArray(value.limitations) ? value.limitations.map(item => text(item)) : [],
  }
}

function batchSummary(raw: unknown): PredictionBatchSummary {
  const value = record(raw)
  const status = value.labelStatusCounts == null ? {} : record(value.labelStatusCounts)
  return {
    batchId: text(value.batchId),
    datasetVersion: text(value.datasetVersion),
    dataset: text(value.dataset),
    model: model(value.model),
    threshold: riskNumber(value.threshold),
    counts: counts(value.counts),
    labelStatusCounts: Object.fromEntries(
      Object.entries(status).map(([key, item]) => [key, finiteNumber(item)]),
    ),
    createdAt: text(value.createdAt),
  }
}

function explanation(raw: unknown): PredictionRecord['explanation'] {
  if (raw == null) return null
  const value = record(raw)
  if (value.status !== 'supported') return null
  return {
    status: text(value.status),
    method: text(value.method),
    items: recordList(value.items).map(item => ({
      feature: text(item.feature),
      value: finiteNumber(item.value),
      baseline: finiteNumber(item.baseline),
      delta: finiteNumber(item.delta),
      direction: item.direction === 'decreases' ? 'decreases' : 'increases',
    })),
    summary: text(value.summary),
  }
}

function predictionRecord(raw: unknown): PredictionRecord {
  const value = record(raw)
  if (value.label !== 0 && value.label !== 1) contractFailed('预测标签无效')
  return {
    predictionId: text(value.predictionId),
    recordId: text(value.recordId),
    authorTime: textOrNull(value.authorTime),
    label: value.label,
    labelStatus: text(value.labelStatus),
    risk: riskNumber(value.risk),
    features: Object.fromEntries(
      Object.entries(record(value.features)).map(([key, item]) => [key, finiteNumber(item)]),
    ),
    explanation: explanation(value.explanation),
  }
}

export async function predictionModels(datasetVersion: string, signal?: AbortSignal): Promise<PredictionModelList> {
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-models?datasetVersion=${encodeURIComponent(datasetVersion)}`,
    method: 'GET',
    signal,
  }))
  return {
    models: recordList(value.models).map(model),
    maxRecords: finiteNumber(value.maxRecords),
  }
}

export async function predictionBatches(signal?: AbortSignal): Promise<PredictionBatchSummary[]> {
  const value = record(await apiRequest({
    path: '/api/v1/user/prediction-batches?limit=30',
    method: 'GET',
    signal,
  }))
  return recordList(value.batches).map(batchSummary)
}

export async function createPredictionBatch(options: {
  datasetVersion: string
  modelId: string
  threshold: number
}): Promise<PredictionBatch> {
  return batch(await apiRequest({
    path: '/api/v1/user/prediction-batches',
    method: 'POST',
    body: options,
  }))
}

export async function predictionBatch(
  batchId: string,
  options: { limit?: number; offset?: number; sort?: 'risk' | 'time' } = {},
  signal?: AbortSignal,
): Promise<PredictionBatchDetail> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 100),
    offset: String(options.offset ?? 0),
    sort: options.sort ?? 'risk',
  })
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-batches/${encodeURIComponent(batchId)}?${query}`,
    method: 'GET',
    signal,
  }))
  return {
    ...batch(value),
    records: recordList(value.records).map(predictionRecord),
    limit: finiteNumber(value.limit),
    offset: finiteNumber(value.offset),
    sort: value.sort === 'time' ? 'time' : 'risk',
  }
}
