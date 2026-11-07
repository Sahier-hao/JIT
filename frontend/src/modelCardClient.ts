import { apiRequest } from './apiClient'
import { finiteNumber, record, text, textList, textOrNull } from './apiContract'

export type ModelMetricMap = Record<string, unknown>

export interface ModelCardPartition {
  name: 'train' | 'validation' | 'test'
  label: string
  available: boolean
  source: string
  reason: string | null
  metrics: ModelMetricMap | null
  records: number | null
  positives: number | null
  negatives: number | null
  start: string | null
  end: string | null
}

export interface ModelCardBenefit {
  available: boolean
  reason: string | null
  reportVersion: number | null
  conclusion: ModelMetricMap | null
  strategies: ModelMetricMap | null
  test: ModelMetricMap | null
  boundary: ModelMetricMap | null
  limitations: string[]
}

export interface ModelCard {
  available: boolean
  reason: string | null
  modelId: string
  name: string
  method: string | null
  featureSchemaVersion: string | null
  runId: string | null
  artifactRunId: string | null
  modelSha256: string | null
  datasetVersion: string | null
  datasetSha256: string | null
  metricSet: string | null
  threshold: number | null
  splitRule: string | null
  dataScale: ModelMetricMap | null
  trainingPerformance: ModelMetricMap | null
  diagnostics: ModelMetricMap | null
  source: ModelMetricMap | null
  partitions: ModelCardPartition[]
  limitations: string[]
  benefit: ModelCardBenefit
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? finiteNumber(value) : null
}

function partitionValue(name: ModelCardPartition['name'], raw: unknown): ModelCardPartition {
  const value = record(raw)
  return {
    name,
    label: text(value.label),
    available: value.available === true,
    source: text(value.source),
    reason: textOrNull(value.reason),
    metrics: value.metrics == null ? null : record(value.metrics),
    records: numberOrNull(value.records),
    positives: numberOrNull(value.positives),
    negatives: numberOrNull(value.negatives),
    start: textOrNull(value.start),
    end: textOrNull(value.end),
  }
}

export function parseModelCard(raw: unknown): ModelCard {
  const value = record(raw)
  const metrics = record(value.metricsByPartition)
  const partitions = record(value.partitions)
  const benefit = record(value.benefit)
  return {
    available: value.available === true,
    reason: textOrNull(value.reason),
    modelId: text(value.modelId),
    name: text(value.name),
    method: textOrNull(value.method),
    featureSchemaVersion: textOrNull(value.featureSchemaVersion),
    runId: textOrNull(value.runId),
    artifactRunId: textOrNull(value.artifactRunId),
    modelSha256: textOrNull(value.modelSha256),
    datasetVersion: textOrNull(value.datasetVersion),
    datasetSha256: textOrNull(value.datasetSha256),
    metricSet: textOrNull(value.metricSet),
    threshold: numberOrNull(value.threshold),
    splitRule: textOrNull(value.splitRule),
    dataScale: value.dataScale == null ? null : record(value.dataScale),
    trainingPerformance: value.trainingPerformance == null ? null : record(value.trainingPerformance),
    diagnostics: value.diagnostics == null ? null : record(value.diagnostics),
    source: value.source == null ? null : record(value.source),
    partitions: (['train', 'validation', 'test'] as const).map(name => {
      const metric = record(metrics[name])
      const split = record(partitions[name])
      return partitionValue(name, {
        ...split,
        ...metric,
        records: split.records,
        positives: split.positives,
        negatives: split.negatives,
      })
    }),
    limitations: textList(value.limitations),
    benefit: {
      available: benefit.available === true,
      reason: textOrNull(benefit.reason),
      reportVersion: numberOrNull(benefit.reportVersion),
      conclusion: benefit.conclusion == null ? null : record(benefit.conclusion),
      strategies: benefit.strategies == null ? null : record(benefit.strategies),
      test: benefit.test == null ? null : record(benefit.test),
      boundary: benefit.boundary == null ? null : record(benefit.boundary),
      limitations: Array.isArray(benefit.limitations) ? textList(benefit.limitations) : [],
    },
  }
}

export async function fetchModelCard(modelId: string, signal?: AbortSignal): Promise<ModelCard> {
  return parseModelCard(await apiRequest({
    path: `/api/v1/model-cards/${encodeURIComponent(modelId)}`,
    method: 'GET',
    signal,
  }))
}
