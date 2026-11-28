import { apiRequest } from '@/lib/apiClient'
import {
  contractFailed, finiteNumber, record, recordList, riskNumber,
  text, textOrNull,
} from '@/lib/apiContract'

export type PredictionMode = 'single' | 'batch'
export type PredictionPartition = 'train' | 'validation' | 'test'
export type LabelAvailability = 'available' | 'unavailable'

export interface PredictionModel {
  modelId: string
  name: string
  method: string | null
  runId: string | null
  featureSchemaVersion: string
  artifactDatasetVersion: string | null
  featureNames: string[]
  isDefault: boolean
  mine: boolean
  shared: boolean
}

export interface PredictionModelList {
  models: PredictionModel[]
  maxRecords: number
}

export interface PredictionSource {
  kind: string
  label: string
  reference: Record<string, unknown>
}

export interface PredictionCounts {
  records: number
  labeledAvailable: number
  unavailable: number
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

export interface PredictionBatch {
  batchId: string
  mode: PredictionMode
  sourceKind: string
  source: PredictionSource
  datasetVersion: string | null
  dataset: string
  splitPreset: string | null
  partition: PredictionPartition | null
  memberSha256: string | null
  model: PredictionModel
  threshold: number
  counts: PredictionCounts
  labelStatusCounts: Record<string, number>
  labelAvailabilityCounts: { available: number; unavailable: number }
  thresholdPreview: ThresholdPreview
  evaluationEligible: boolean
  evaluationReason: string
  explanationCoverage: { method: string; limit: number; recorded: number; failed: number }
  featureNames: string[]
  createdAt: string
  limitations: string[]
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
  label: 0 | 1 | null
  labelStatus: string
  labelAvailability: LabelAvailability
  sourceKind: string
  sourceRef: string | null
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
  search: string | null
}

export interface PredictionSample {
  recordId: string
  authorTime: string | null
  label: 0 | 1 | null
  labelStatus: string
  labelAvailability: LabelAvailability
  features: Record<string, number>
  sourceKind: string
}

export interface PredictionSamplePage {
  datasetVersion: string
  dataset: string
  schema: string
  total: number
  limit: number
  offset: number
  search: string | null
  samples: PredictionSample[]
}

export interface PartitionStat {
  count: number
  positives: number | null
  start: string | null
  end: string | null
}

export interface ModelSplitOption {
  source: 'model'
  modelId: string
  splitPreset: string | null
  memberSha256: string
  partitions: Record<PredictionPartition, PartitionStat>
}

export interface PresetSplitOption {
  id: string
  available: boolean
  reason: string | null
  ratios: Record<PredictionPartition, number>
  memberSha256?: string
  partitions?: Record<PredictionPartition, PartitionStat>
}

export interface PredictionSplitOptions {
  datasetVersion: string
  modelId: string
  featureSchemaVersion: string
  full: { count: number; memberSha256: string }
  modelSplit: ModelSplitOption | null
  presets: PresetSplitOption[]
}

export interface PredictionEvaluation {
  format: 'user-prediction-evaluation-v1'
  batchId: string
  mode: PredictionMode
  model: PredictionModel
  datasetVersion: string | null
  dataset: string | null
  source: PredictionSource | null
  sourceKind: string
  splitPreset: string | null
  partition: PredictionPartition | null
  memberSha256: string | null
  threshold: number
  eligible: boolean
  reason: string
  counts: PredictionCounts
  labelStatusCounts: Record<string, number>
  labelAvailabilityCounts: { available: number; unavailable: number }
  thresholdPreview: ThresholdPreview
  confusion: { tp: number; fp: number; tn: number; fn: number }
  precision: number | null
  recall: number | null
  f1: number | null
  limitations: string[]
}

function count(value: unknown, field = '计数'): number {
  const parsed = finiteNumber(value)
  if (!Number.isInteger(parsed) || parsed < 0) contractFailed(`${field} 无效`)
  return parsed
}

function nullableCount(value: unknown): 0 | 1 | null {
  if (value == null) return null
  const parsed = count(value, '标签')
  if (parsed !== 0 && parsed !== 1) contractFailed('真实标签无效')
  return parsed
}

function model(raw: unknown): PredictionModel {
  const value = record(raw)
  const featureNames = Array.isArray(value.featureNames)
    ? value.featureNames.map(item => text(item)) : []
  return {
    modelId: text(value.modelId),
    name: text(value.name),
    method: textOrNull(value.method),
    runId: textOrNull(value.runId),
    featureSchemaVersion: text(value.featureSchemaVersion),
    artifactDatasetVersion: textOrNull(value.artifactDatasetVersion),
    featureNames,
    isDefault: value.isDefault === true,
    mine: value.mine === true,
    shared: value.shared === true,
  }
}

function counts(raw: unknown): PredictionCounts {
  const value = record(raw)
  const records = count(value.records, '记录数')
  const positives = count(value.positives, '正例数')
  const negatives = count(value.negatives, '负例数')
  const labeledAvailable = value.labeledAvailable == null
    ? positives + negatives : count(value.labeledAvailable, '可用标签数')
  return {
    records,
    labeledAvailable,
    unavailable: value.unavailable == null
      ? Math.max(0, records - labeledAvailable) : count(value.unavailable, '无标签数'),
    positives,
    negatives,
    flagged: count(value.flagged, '告警数'),
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
    positives: count(value.positives, '正例数'),
    negatives: count(value.negatives, '负例数'),
    truePositives: numberList(value.truePositives, 'truePositives'),
    falsePositives: numberList(value.falsePositives, 'falsePositives'),
  }
}

function source(raw: unknown, fallbackKind: string): PredictionSource {
  if (raw == null) {
    return { kind: fallbackKind, label: fallbackKind === 'dataset' ? '数据版本' : fallbackKind, reference: {} }
  }
  const value = record(raw)
  return {
    kind: text(value.kind),
    label: text(value.label),
    reference: value.reference == null ? {} : record(value.reference),
  }
}

function availability(raw: unknown): LabelAvailability {
  return raw === 'available' ? 'available' : raw === 'unavailable' ? 'unavailable' : contractFailed('标签可用性无效')
}

function partition(raw: unknown): PredictionPartition | null {
  if (raw == null) return null
  if (raw === 'train' || raw === 'validation' || raw === 'test') return raw
  contractFailed('预测分区无效')
}

function batch(raw: unknown): PredictionBatch {
  const value = record(raw)
  const status = value.labelStatusCounts == null ? {} : record(value.labelStatusCounts)
  const availabilityCounts = value.labelAvailabilityCounts == null
    ? null : record(value.labelAvailabilityCounts)
  const coverage = record(value.explanationCoverage)
  const modelValue = model(value.model)
  const sourceKind = typeof value.sourceKind === 'string' ? value.sourceKind : 'dataset'
  const eligible = value.evaluationEligible === true
  return {
    batchId: text(value.batchId),
    mode: value.mode === 'single' ? 'single' : 'batch',
    sourceKind,
    source: source(value.source, sourceKind),
    datasetVersion: textOrNull(value.datasetVersion),
    dataset: textOrNull(value.dataset) ?? '未命名数据',
    splitPreset: textOrNull(value.splitPreset),
    partition: partition(value.partition),
    memberSha256: textOrNull(value.memberSha256),
    model: modelValue,
    threshold: riskNumber(value.threshold),
    counts: counts(value.counts),
    labelStatusCounts: Object.fromEntries(
      Object.entries(status).map(([key, item]) => [key, count(item)]),
    ),
    labelAvailabilityCounts: {
      available: availabilityCounts ? count(availabilityCounts.available) : 0,
      unavailable: availabilityCounts ? count(availabilityCounts.unavailable) : 0,
    },
    thresholdPreview: thresholdPreview(value.thresholdPreview),
    evaluationEligible: eligible,
    evaluationReason: textOrNull(value.evaluationReason)
      ?? (eligible ? '包含可用真实标签，可进入评估' : '无可用真实标签，不进入评估'),
    explanationCoverage: {
      method: text(coverage.method),
      limit: count(coverage.limit),
      recorded: count(coverage.recorded),
      failed: count(coverage.failed),
    },
    featureNames: Array.isArray(value.featureNames)
      ? value.featureNames.map(item => text(item)) : contractFailed('特征字段缺失'),
    createdAt: text(value.createdAt),
    limitations: Array.isArray(value.limitations) ? value.limitations.map(item => text(item)) : [],
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
  return {
    predictionId: text(value.predictionId),
    recordId: text(value.recordId),
    authorTime: textOrNull(value.authorTime),
    label: nullableCount(value.label),
    labelStatus: text(value.labelStatus),
    labelAvailability: availability(value.labelAvailability),
    sourceKind: text(value.sourceKind),
    sourceRef: textOrNull(value.sourceRef),
    risk: riskNumber(value.risk),
    features: Object.fromEntries(
      Object.entries(record(value.features)).map(([key, item]) => [key, finiteNumber(item)]),
    ),
    explanation: explanation(value.explanation),
  }
}

function sample(raw: unknown): PredictionSample {
  const value = record(raw)
  return {
    recordId: text(value.recordId),
    authorTime: textOrNull(value.authorTime),
    label: nullableCount(value.label),
    labelStatus: text(value.labelStatus),
    labelAvailability: availability(value.labelAvailability),
    features: Object.fromEntries(
      Object.entries(record(value.features)).map(([key, item]) => [key, finiteNumber(item)]),
    ),
    sourceKind: text(value.sourceKind),
  }
}

function partitionStat(raw: unknown): PartitionStat {
  const value = record(raw)
  return {
    count: count(value.count),
    positives: value.positives == null ? null : count(value.positives),
    start: textOrNull(value.start),
    end: textOrNull(value.end),
  }
}

function partitionMap(raw: unknown): Record<PredictionPartition, PartitionStat> {
  const value = record(raw)
  return {
    train: partitionStat(value.train),
    validation: partitionStat(value.validation),
    test: partitionStat(value.test),
  }
}

export async function predictionModels(
  selector: string | { datasetVersion?: string; schema?: string } | null,
  signal?: AbortSignal,
): Promise<PredictionModelList> {
  const query = new URLSearchParams()
  if (typeof selector === 'string') {
    if (selector) query.set('datasetVersion', selector)
  } else if (selector) {
    if (selector.datasetVersion) query.set('datasetVersion', selector.datasetVersion)
    if (selector.schema) query.set('schema', selector.schema)
  }
  const suffix = query.size ? `?${query}` : ''
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-models${suffix}`,
    method: 'GET',
    signal,
  }))
  return {
    models: recordList(value.models).map(model),
    maxRecords: count(value.maxRecords),
  }
}

export async function predictionBatches(signal?: AbortSignal): Promise<PredictionBatch[]> {
  const value = record(await apiRequest({
    path: '/api/v1/user/prediction-batches?limit=30',
    method: 'GET',
    signal,
  }))
  return recordList(value.batches).map(batch)
}

export async function createPredictionBatch(options: {
  datasetVersion: string
  modelId: string
  threshold: number
  partition?: PredictionPartition
  splitSource?: 'model' | 'preset'
  splitPreset?: string
}): Promise<PredictionBatch> {
  return batch(await apiRequest({
    path: '/api/v1/user/prediction-batches',
    method: 'POST',
    body: options,
  }))
}

export async function createSinglePrediction(options: {
  modelId: string
  threshold: number
  source:
    | { kind: 'dataset'; datasetVersion: string; recordId: string }
    | { kind: 'project'; repositoryId: string; syncId: string; commitId: string }
    | { kind: 'manual'; features: Record<string, number>; recordId?: string }
}): Promise<PredictionBatch> {
  return batch(await apiRequest({
    path: '/api/v1/user/prediction-batches/single',
    method: 'POST',
    body: options,
  }))
}

export async function createUnlabeledPrediction(
  file: File,
  options: { modelId: string; threshold: number },
): Promise<PredictionBatch> {
  const query = new URLSearchParams({
    modelId: options.modelId,
    threshold: String(options.threshold),
    filename: file.name,
  })
  return batch(await apiRequest({
    path: `/api/v1/user/prediction-batches/unlabeled?${query}`,
    method: 'POST',
    rawBody: file,
    contentType: 'text/csv',
  }))
}

export async function predictionBatch(
  batchId: string,
  options: { limit?: number; offset?: number; sort?: 'risk' | 'time'; search?: string } = {},
  signal?: AbortSignal,
): Promise<PredictionBatchDetail> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 100),
    offset: String(options.offset ?? 0),
    sort: options.sort ?? 'risk',
  })
  if (options.search) query.set('search', options.search)
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-batches/${encodeURIComponent(batchId)}?${query}`,
    method: 'GET',
    signal,
  }))
  return {
    ...batch(value),
    records: recordList(value.records).map(predictionRecord),
    limit: count(value.limit),
    offset: count(value.offset),
    sort: value.sort === 'time' ? 'time' : 'risk',
    search: textOrNull(value.search),
  }
}

export async function predictionSamples(
  datasetVersion: string,
  options: { limit?: number; offset?: number; search?: string } = {},
  signal?: AbortSignal,
): Promise<PredictionSamplePage> {
  const query = new URLSearchParams({
    datasetVersion,
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
  })
  if (options.search) query.set('search', options.search)
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-samples?${query}`,
    method: 'GET',
    signal,
  }))
  return {
    datasetVersion: text(value.datasetVersion),
    dataset: text(value.dataset),
    schema: text(value.schema),
    total: count(value.total),
    limit: count(value.limit),
    offset: count(value.offset),
    search: textOrNull(value.search),
    samples: recordList(value.samples).map(sample),
  }
}

export async function predictionSplits(
  datasetVersion: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<PredictionSplitOptions> {
  const query = new URLSearchParams({ datasetVersion, modelId })
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-splits?${query}`,
    method: 'GET',
    signal,
  }))
  const modelSplitRaw = value.modelSplit == null ? null : record(value.modelSplit)
  const full = record(value.full)
  return {
    datasetVersion: text(value.datasetVersion),
    modelId: text(value.modelId),
    featureSchemaVersion: text(value.featureSchemaVersion),
    full: {
      count: count(full.count),
      memberSha256: text(full.memberSha256),
    },
    modelSplit: modelSplitRaw ? {
      source: 'model',
      modelId: text(modelSplitRaw.modelId),
      splitPreset: textOrNull(modelSplitRaw.splitPreset),
      memberSha256: text(modelSplitRaw.memberSha256),
      partitions: partitionMap(modelSplitRaw.partitions),
    } : null,
    presets: recordList(value.presets).map(item => {
      const preset = record(item)
      return {
        id: text(preset.id),
        available: preset.available === true,
        reason: textOrNull(preset.reason),
        ratios: {
          train: finiteNumber(record(preset.ratios).train),
          validation: finiteNumber(record(preset.ratios).validation),
          test: finiteNumber(record(preset.ratios).test),
        },
        ...(preset.memberSha256 ? { memberSha256: text(preset.memberSha256) } : {}),
        ...(preset.partitions ? { partitions: partitionMap(preset.partitions) } : {}),
      }
    }),
  }
}

export async function predictionEvaluation(
  batchId: string,
  signal?: AbortSignal,
): Promise<PredictionEvaluation> {
  const value = record(await apiRequest({
    path: `/api/v1/user/prediction-batches/${encodeURIComponent(batchId)}/evaluation`,
    method: 'GET',
    signal,
  }))
  if (value.format !== 'user-prediction-evaluation-v1') contractFailed('评估响应类型不一致')
  const confusion = record(value.confusion)
  const availability = record(value.labelAvailabilityCounts)
  return {
    format: 'user-prediction-evaluation-v1',
    batchId: text(value.batchId),
    mode: value.mode === 'single' ? 'single' : 'batch',
    model: model(value.model),
    datasetVersion: textOrNull(value.datasetVersion),
    dataset: textOrNull(value.dataset),
    source: value.source == null ? null : source(value.source, text(value.sourceKind)),
    sourceKind: text(value.sourceKind),
    splitPreset: textOrNull(value.splitPreset),
    partition: partition(value.partition),
    memberSha256: textOrNull(value.memberSha256),
    threshold: riskNumber(value.threshold),
    eligible: value.eligible === true,
    reason: text(value.reason),
    counts: counts(value.counts),
    labelStatusCounts: Object.fromEntries(
      Object.entries(record(value.labelStatusCounts)).map(([key, item]) => [key, count(item)]),
    ),
    labelAvailabilityCounts: {
      available: count(availability.available),
      unavailable: count(availability.unavailable),
    },
    thresholdPreview: thresholdPreview(value.thresholdPreview),
    confusion: {
      tp: count(confusion.tp),
      fp: count(confusion.fp),
      tn: count(confusion.tn),
      fn: count(confusion.fn),
    },
    precision: value.precision == null ? null : riskNumber(value.precision),
    recall: value.recall == null ? null : riskNumber(value.recall),
    f1: value.f1 == null ? null : riskNumber(value.f1),
    limitations: Array.isArray(value.limitations) ? value.limitations.map(item => text(item)) : [],
  }
}
