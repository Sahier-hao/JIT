import { apiRequest } from './apiClient'
import type { Row } from './adminContracts'
import { contractFailed, finiteNumber, record, text, textOrNull, textList } from './apiContract'

export interface BenefitMetric { value: number | null; reason: string | null }
export interface BenefitCoverage {
  positives: number
  totalLoc: number
  budgetLoc: number
  selectedCount: number
  usedLoc: number
  issuesCovered: number
  precisionAtBudget: BenefitMetric
}
export interface BenefitStrategy {
  ordering: string
  recall20Loc: BenefitMetric
  ifa: BenefitMetric
  popt: BenefitMetric
  coverage: BenefitCoverage
}
export interface BenefitRandomSummary {
  mean: number | null
  std: number | null
  min: number | null
  max: number | null
  validRuns: number
  reason: string | null
}
export interface BenefitRandom {
  runs: number
  seed: number
  recall20Loc: BenefitRandomSummary
  ifa: BenefitRandomSummary
  popt: BenefitRandomSummary
  precisionAtBudget: BenefitRandomSummary
  coverage: {
    issuesCovered: BenefitRandomSummary
    selectedCount: BenefitRandomSummary
    usedLoc: BenefitRandomSummary
  }
}
export interface BenefitReport {
  reportId: string
  source: string
  kind: string
  reportVersion: number
  generatedUtc: string
  artifact: {
    runId: string
    artifactPath: string | null
    artifactKey: string | null
    datasetVersion: string | null
    schema: string | null
    metricSet: string | null
    modelName: string | null
    modelId: string | null
    modelSha256: string | null
  }
  test: {
    records: number
    positives: number
    negatives: number
    totalLoc: number
    budgetLoc: number
    startEpoch: number | null
    endEpoch: number | null
    labelRule: string | null
    split: Row | null
  }
  strategies: { model: BenefitStrategy; time: BenefitStrategy; random: BenefitRandom }
  comparisons: Row
  conclusion: { sentence: string; recall20: Row }
  existingMetrics: Row | null
  parameterSelection: string
  limitations: string[]
  boundary: Row
  sourceHashes: Row
}
export interface ModelBenefit {
  available: boolean
  modelId: string
  runId: string
  reason?: string
  reportId?: string
  source?: string
  report?: BenefitReport
}

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
function metric(raw: unknown): BenefitMetric {
  const value = record(raw)
  return { value: numberOrNull(value.value), reason: textOrNull(value.reason) }
}
function coverage(raw: unknown): BenefitCoverage {
  const value = record(raw)
  return {
    positives: finiteNumber(value.positives), totalLoc: finiteNumber(value.totalLoc),
    budgetLoc: finiteNumber(value.budgetLoc), selectedCount: finiteNumber(value.selectedCount),
    usedLoc: finiteNumber(value.usedLoc), issuesCovered: finiteNumber(value.issuesCovered),
    precisionAtBudget: metric(value.precisionAtBudget),
  }
}
function strategy(raw: unknown): BenefitStrategy {
  const value = record(raw)
  return {
    ordering: text(value.ordering), recall20Loc: metric(value.recall20Loc),
    ifa: metric(value.ifa), popt: metric(value.popt), coverage: coverage(value.coverage),
  }
}
function randomSummary(raw: unknown): BenefitRandomSummary {
  const value = record(raw)
  return {
    mean: numberOrNull(value.mean), std: numberOrNull(value.std), min: numberOrNull(value.min),
    max: numberOrNull(value.max), validRuns: finiteNumber(value.validRuns),
    reason: textOrNull(value.reason),
  }
}
function random(raw: unknown): BenefitRandom {
  const value = record(raw)
  const cover = record(value.coverage)
  return {
    runs: finiteNumber(value.runs), seed: finiteNumber(value.seed),
    recall20Loc: randomSummary(value.recall20Loc), ifa: randomSummary(value.ifa),
    popt: randomSummary(value.popt), precisionAtBudget: randomSummary(value.precisionAtBudget),
    coverage: {
      issuesCovered: randomSummary(cover.issuesCovered),
      selectedCount: randomSummary(cover.selectedCount),
      usedLoc: randomSummary(cover.usedLoc),
    },
  }
}
export function parseBenefitReport(raw: unknown): BenefitReport {
  const value = record(raw)
  if (value.kind !== 'model-benefit-evaluation') contractFailed('收益评估报告类型不一致')
  const artifact = record(value.artifact)
  const model = record(artifact.model ?? {})
  const test = record(value.test)
  const conclusion = record(value.conclusion)
  const strategies = record(value.strategies)
  return {
    reportId: text(value.reportId), source: text(value.source), kind: text(value.kind),
    reportVersion: finiteNumber(value.reportVersion), generatedUtc: text(value.generatedUtc),
    artifact: {
      runId: text(artifact.runId), artifactPath: textOrNull(artifact.artifactPath),
      artifactKey: textOrNull(artifact.artifactKey), datasetVersion: textOrNull(artifact.datasetVersion),
      schema: textOrNull(artifact.schema), metricSet: textOrNull(artifact.metricSet),
      modelName: textOrNull(model.name), modelId: textOrNull(model.id),
      modelSha256: textOrNull(artifact.modelSha256),
    },
    test: {
      records: finiteNumber(test.records), positives: finiteNumber(test.positives),
      negatives: finiteNumber(test.negatives), totalLoc: finiteNumber(test.totalLoc),
      budgetLoc: finiteNumber(test.budgetLoc), startEpoch: numberOrNull(test.startEpoch),
      endEpoch: numberOrNull(test.endEpoch),
      labelRule: typeof test.source === 'object' && test.source !== null ? textOrNull(record(test.source).labelRule) : null,
      split: test.split === null || test.split === undefined ? null : record(test.split),
    },
    strategies: { model: strategy(strategies.model), time: strategy(strategies.time),
      random: random(strategies.random) },
    comparisons: record(value.comparisons),
    conclusion: { sentence: text(conclusion.sentence), recall20: record(conclusion.recall20 ?? {}) },
    existingMetrics: value.existingMetrics == null ? null : record(value.existingMetrics),
    parameterSelection: text(value.parameterSelection), limitations: textList(value.limitations),
    boundary: record(value.boundary), sourceHashes: record(value.sourceHashes),
  }
}

export async function fetchModelBenefit(modelId: string, signal?: AbortSignal): Promise<ModelBenefit> {
  const body = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}/benefit`, method: 'GET', signal }))
  if (body.modelId !== modelId) contractFailed('收益评估不属于当前模型')
  const runId = text(body.runId)
  if (body.available !== true) {
    return { available: false, modelId, runId, reason: textOrNull(body.reason) ?? '尚无该模型的收益评估报告' }
  }
  const report = parseBenefitReport({ ...record(body.report), reportId: text(body.reportId), source: text(body.source) })
  if (report.artifact.runId !== runId) contractFailed('收益评估运行身份不一致')
  return { available: true, modelId, runId, reportId: text(body.reportId), source: text(body.source), report }
}
