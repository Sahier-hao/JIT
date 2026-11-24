import { apiRequest } from '@/lib/apiClient'
import {
  contractFailed,
  finiteNumber,
  flag,
  record,
  recordList,
  riskNumber,
  text,
  textOrNull,
  utcTimestamp,
  uuidText,
} from '@/lib/apiContract'

export type ExplanationUnit = 'probability' | 'logit'
export type ExplanationStatus = 'not-generated' | 'supported' | 'not-supported'

export interface ExplanationContext {
  repositoryId: string
  viewSyncId: string
  commitId: string
  risk: number
  modelId?: string | null
  runId?: string | null
  datasetVersion?: string | null
}

export interface FeatureEffect {
  feature: string
  value: number
  baseline: number
  delta: number
  direction: 'increases' | 'decreases'
}

export interface ExplanationStability {
  status: 'stable' | 'unstable'
  rounds: number
  topFeatures: string[][]
  baseOrder: string[]
}

export interface RepositoryExplanation {
  explanationStatus: ExplanationStatus
  explanation: FeatureEffect[]
  explanationMethod: string | null
  explanationUnit: ExplanationUnit
  explanationSummary: string | null
  explanationReason: string | null
  reasonCode: string | null
  contributionTotal: number | null
  baselineSource: 'zero' | 'mixed' | 'model-dataset-mean' | 'training-partition-mean' | null
  baselineDatasetVersion: string | null
  baselineHash: string | null
  trainingPartitionSize: number | null
  stability: ExplanationStability | null
  missingBaselineFeatures: string[]
  featureSchemaVersion: string | null
  modelSha256: string | null
  generatedAt: string | null
  limitations: string[]
}

export interface ExplanationMethod {
  method: string
  name: string
  applicableModels: string[]
  unit: ExplanationUnit
  baseline: string
  cost: string
  deterministic: boolean
  limitations: string[]
}

export interface SavedExplanationMethod {
  method: string
  status: 'supported' | 'not-supported'
  generatedAt: string | null
}

export interface RepositoryExplanationMethods {
  repositoryId: string
  viewSyncId: string
  commitId: string
  modelId: string | null
  runId: string | null
  datasetVersion: string | null
  defaultMethod: string
  modelAvailable: boolean
  reasonCode: string | null
  modelSha256: string | null
  methods: ExplanationMethod[]
  savedMethods: SavedExplanationMethod[]
}

export interface RepositoryExplanationList {
  repositoryId: string
  viewSyncId: string
  commitId: string
  modelId: string | null
  runId: string | null
  datasetVersion: string | null
  explanations: RepositoryExplanation[]
}

/** 前端白名单：方法标识固定为后端已注册的两个方法，并锁定各自的贡献单位。 */
const METHOD_UNITS: Record<string, ExplanationUnit> = {
  'occlusion-mean-v1': 'probability',
  'linear-logodds-v1': 'logit',
}

const BASELINE_SOURCES = ['zero', 'mixed', 'model-dataset-mean', 'training-partition-mean'] as const

function parseIdentity(raw: Record<string, unknown>, context: ExplanationContext, withRisk: boolean): void {
  if (
    uuidText(raw.repositoryId) !== context.repositoryId ||
    uuidText(raw.viewSyncId) !== context.viewSyncId ||
    text(raw.commitId) !== context.commitId
  ) contractFailed('模型解释的分析或提交身份不一致')
  if (withRisk && riskNumber(raw.risk) !== context.risk) contractFailed('模型解释的风险身份不一致')
  for (const key of ['modelId', 'runId', 'datasetVersion'] as const) {
    if (context[key] !== undefined && textOrNull(raw[key]) !== context[key]) contractFailed('模型解释的来源不一致')
  }
}

function parseExplanationUnit(value: unknown): ExplanationUnit {
  const raw = text(value)
  if (raw !== 'probability' && raw !== 'logit') contractFailed('未知解释单位')
  return raw
}

function parseStatus(value: unknown): ExplanationStatus {
  const raw = text(value)
  if (raw !== 'not-generated' && raw !== 'supported' && raw !== 'not-supported') contractFailed('未知解释状态')
  return raw
}

function parseBaselineSource(value: unknown): RepositoryExplanation['baselineSource'] {
  const raw = value === null || value === undefined ? null : text(value)
  if (raw !== null && !(BASELINE_SOURCES as readonly string[]).includes(raw)) contractFailed('未知基线口径')
  return raw as RepositoryExplanation['baselineSource']
}

function parseNullableFinite(value: unknown): number | null {
  return value === null || value === undefined ? null : finiteNumber(value)
}

function parseNonNegativeInteger(value: unknown): number {
  const parsed = finiteNumber(value)
  if (!Number.isInteger(parsed) || parsed < 0) contractFailed('非负整数无效')
  return parsed
}

function parseStability(value: unknown): ExplanationStability {
  const raw = record(value)
  const status = text(raw.status)
  if (status !== 'stable' && status !== 'unstable') contractFailed('稳定性状态无效')
  const rounds = parseNonNegativeInteger(raw.rounds)
  if (rounds < 1) contractFailed('稳定性轮次无效')
  const topFeatures = Array.isArray(raw.topFeatures)
    ? raw.topFeatures.map((round) => (Array.isArray(round) ? round.map((item) => text(item)) : contractFailed()))
    : contractFailed()
  const baseOrder = Array.isArray(raw.baseOrder) ? raw.baseOrder.map((item) => text(item)) : contractFailed()
  return { status, rounds, topFeatures, baseOrder }
}

function parseFeatureEffect(item: Record<string, unknown>, unit: ExplanationUnit): FeatureEffect {
  const feature = text(item.feature)
  const direction = text(item.direction)
  const value = finiteNumber(item.value)
  const baseline = finiteNumber(item.baseline)
  const delta = finiteNumber(item.delta)
  if (value < 0 || baseline < 0) contractFailed('解释特征值无效')
  if (delta === 0) contractFailed('解释贡献不能为零')
  const expected = delta > 0 ? 'increases' : 'decreases'
  if (direction !== expected) contractFailed('解释方向与贡献符号不一致')
  // 概率变化的范围是 [-1,1]；log-odds 变化只要求是有限数，可能超过 1。
  if (unit === 'probability' && Math.abs(delta) > 1) contractFailed('概率变化超出 [-1,1]')
  return { feature, value, baseline, delta, direction: direction as FeatureEffect['direction'] }
}

function parseTextList(value: unknown, message: string): string[] {
  if (!Array.isArray(value)) contractFailed(message)
  return value.map((item) => text(item, message))
}

export function parseRepositoryExplanation(
  value: unknown,
  context: ExplanationContext,
  expectation?: { method?: string },
): RepositoryExplanation {
  const raw = record(value)
  parseIdentity(raw, context, true)
  const unit = parseExplanationUnit(raw.explanationUnit)
  const method = textOrNull(raw.explanationMethod)
  if (method !== null) {
    const declaredUnit = METHOD_UNITS[method]
    if (declaredUnit === undefined) contractFailed('未知解释方法')
    if (unit !== declaredUnit) contractFailed('解释方法与单位不一致')
  }
  if (expectation?.method !== undefined && method !== expectation.method) contractFailed('解释方法不一致')
  const status = parseStatus(raw.explanationStatus)
  const items = recordList(raw.explanation).map((item) => parseFeatureEffect(item, unit))
  if (
    items.length > 5 ||
    new Set(items.map((item) => item.feature)).size !== items.length ||
    items.some((item, index) => index > 0 && Math.abs(item.delta) > Math.abs(items[index - 1].delta))
  ) contractFailed('解释项排序或去重无效')
  if (status !== 'supported' && items.length) contractFailed('未支持解释不应包含贡献项')
  const summary = textOrNull(raw.explanationSummary)
  const baselineSource = parseBaselineSource(raw.baselineSource)
  if (status === 'supported' && (!method || !summary)) contractFailed('已支持解释缺少方法或结论')
  if (status === 'supported' && baselineSource === null) contractFailed('已支持解释缺少基线口径')
  const contributionTotal = parseNullableFinite(raw.contributionTotal)
  if (unit === 'logit' && status === 'supported' && contributionTotal === null) contractFailed('logit 解释缺少总贡献')
  const stability = raw.stability === null || raw.stability === undefined ? null : parseStability(raw.stability)
  return {
    explanationStatus: status,
    explanation: items,
    explanationMethod: method,
    explanationUnit: unit,
    explanationSummary: summary,
    explanationReason: textOrNull(raw.explanationReason),
    reasonCode: textOrNull(raw.reasonCode),
    contributionTotal,
    baselineSource,
    baselineDatasetVersion: textOrNull(raw.baselineDatasetVersion),
    baselineHash: raw.baselineHash === null || raw.baselineHash === undefined ? null : textOrNull(raw.baselineHash),
    trainingPartitionSize:
      raw.trainingPartitionSize === null || raw.trainingPartitionSize === undefined ? null : parseNonNegativeInteger(raw.trainingPartitionSize),
    stability,
    missingBaselineFeatures: parseTextList(raw.missingBaselineFeatures, '缺失基线字段无效'),
    featureSchemaVersion: textOrNull(raw.featureSchemaVersion),
    modelSha256: textOrNull(raw.modelSha256),
    generatedAt: raw.generatedAt == null ? null : utcTimestamp(raw.generatedAt),
    limitations: parseTextList(raw.limitations, '解释限制说明无效'),
  }
}

export function parseRepositoryExplanationMethods(
  value: unknown,
  context: ExplanationContext,
): RepositoryExplanationMethods {
  const raw = record(value)
  parseIdentity(raw, context, false)
  const methods = recordList(raw.methods).map((item): ExplanationMethod => {
    const methodId = text(item.method)
    const unit = parseExplanationUnit(item.unit)
    const declaredUnit = METHOD_UNITS[methodId]
    if (declaredUnit !== undefined && unit !== declaredUnit) contractFailed('方法目录的单位不一致')
    const applicableModels = Array.isArray(item.applicableModels) && item.applicableModels.length
      ? item.applicableModels.map((model) => text(model))
      : contractFailed('方法适用模型无效')
    const limitations = Array.isArray(item.limitations) && item.limitations.length
      ? item.limitations.map((note) => text(note))
      : contractFailed('方法限制说明无效')
    return {
      method: methodId,
      name: text(item.name),
      applicableModels,
      unit,
      baseline: text(item.baseline),
      cost: text(item.cost),
      deterministic: flag(item.deterministic),
      limitations,
    }
  })
  const savedMethods = recordList(raw.savedMethods).map((item): SavedExplanationMethod => {
    const status = text(item.status)
    if (status !== 'supported' && status !== 'not-supported') contractFailed('已保存方法状态无效')
    return {
      method: text(item.method),
      status,
      generatedAt: item.generatedAt == null ? null : utcTimestamp(item.generatedAt),
    }
  })
  return {
    repositoryId: uuidText(raw.repositoryId),
    viewSyncId: uuidText(raw.viewSyncId),
    commitId: text(raw.commitId),
    modelId: textOrNull(raw.modelId),
    runId: textOrNull(raw.runId),
    datasetVersion: textOrNull(raw.datasetVersion),
    defaultMethod: text(raw.defaultMethod),
    modelAvailable: flag(raw.modelAvailable),
    reasonCode: textOrNull(raw.reasonCode),
    modelSha256: textOrNull(raw.modelSha256),
    methods,
    savedMethods,
  }
}

export function parseRepositoryExplanationList(
  value: unknown,
  context: ExplanationContext,
): RepositoryExplanationList {
  const raw = record(value)
  parseIdentity(raw, context, false)
  return {
    repositoryId: uuidText(raw.repositoryId),
    viewSyncId: uuidText(raw.viewSyncId),
    commitId: text(raw.commitId),
    modelId: textOrNull(raw.modelId),
    runId: textOrNull(raw.runId),
    datasetVersion: textOrNull(raw.datasetVersion),
    explanations: recordList(raw.explanations).map((item) => parseRepositoryExplanation(item, context)),
  }
}

function explanationPath(context: ExplanationContext, resource: string, method?: string): string {
  const params = new URLSearchParams({ viewSyncId: context.viewSyncId })
  if (method) params.set('method', method)
  return `/api/v1/repositories/${encodeURIComponent(context.repositoryId)}/commits/${encodeURIComponent(context.commitId)}/${resource}?${params.toString()}`
}

export function requestRepositoryExplanation(
  context: ExplanationContext,
  options: { generate?: boolean; method?: string; signal?: AbortSignal } = {},
): Promise<RepositoryExplanation> {
  return apiRequest({
    path: explanationPath(context, 'explanation', options.method),
    method: options.generate ? 'POST' : 'GET',
    signal: options.signal,
  }).then((body) => parseRepositoryExplanation(body, context, options.method ? { method: options.method } : undefined))
}

export function requestRepositoryExplanationMethods(
  context: ExplanationContext,
  signal?: AbortSignal,
): Promise<RepositoryExplanationMethods> {
  return apiRequest({ path: explanationPath(context, 'explanation-methods'), method: 'GET', signal }).then((body) =>
    parseRepositoryExplanationMethods(body, context),
  )
}

export function requestRepositoryExplanations(
  context: ExplanationContext,
  signal?: AbortSignal,
): Promise<RepositoryExplanationList> {
  return apiRequest({ path: explanationPath(context, 'explanations'), method: 'GET', signal }).then((body) =>
    parseRepositoryExplanationList(body, context),
  )
}
