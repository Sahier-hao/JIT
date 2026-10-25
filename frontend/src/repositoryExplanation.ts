import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, record, recordList, riskNumber, text, textOrNull, utcTimestamp, uuidText } from './apiContract'

export interface ExplanationContext {
  repositoryId: string; viewSyncId: string; commitId: string; risk: number
  modelId?: string | null; runId?: string | null; datasetVersion?: string | null
}
export interface FeatureEffect { feature: string; value: number; baseline: number; delta: number; direction: 'increases' | 'decreases' }
export interface RepositoryExplanation {
  explanationStatus: 'not-generated' | 'supported' | 'not-supported'
  explanation: FeatureEffect[]; explanationMethod: string | null; explanationSummary: string | null
  explanationReason: string | null; baselineSource: string | null; baselineDatasetVersion: string | null
  missingBaselineFeatures: string[]; featureSchemaVersion: string | null; generatedAt: string | null; limitations: string[]
}

export function parseRepositoryExplanation(value: unknown, context: ExplanationContext): RepositoryExplanation {
  const raw = record(value)
  if (uuidText(raw.repositoryId) !== context.repositoryId || uuidText(raw.viewSyncId) !== context.viewSyncId || text(raw.commitId) !== context.commitId || riskNumber(raw.risk) !== context.risk) contractFailed('模型解释的分析或提交身份不一致')
  for (const key of ['modelId', 'runId', 'datasetVersion'] as const) {
    if (context[key] !== undefined && textOrNull(raw[key]) !== context[key]) contractFailed('模型解释的来源不一致')
  }
  const status = text(raw.explanationStatus)
  if (!['not-generated', 'supported', 'not-supported'].includes(status)) contractFailed()
  const items = recordList(raw.explanation).map(item => {
    const feature = text(item.feature), direction = text(item.direction)
    const value = finiteNumber(item.value), baseline = finiteNumber(item.baseline), delta = finiteNumber(item.delta)
    if (value < 0 || baseline < 0 || Math.abs(delta) > 1 || delta === 0 || direction !== (delta > 0 ? 'increases' : 'decreases')) contractFailed()
    return { feature, value, baseline, delta, direction: direction as FeatureEffect['direction'] }
  })
  if (items.length > 5 || new Set(items.map(item => item.feature)).size !== items.length || items.some((item, index) => index > 0 && Math.abs(item.delta) > Math.abs(items[index - 1].delta))) contractFailed()
  if (status !== 'supported' && items.length) contractFailed()
  const baselineSource = textOrNull(raw.baselineSource)
  if (status === 'supported' && !['zero', 'mixed', 'model-dataset-mean'].includes(baselineSource ?? '')) contractFailed()
  const method = textOrNull(raw.explanationMethod), summary = textOrNull(raw.explanationSummary)
  if (status === 'supported' && (!method || !summary)) contractFailed()
  return { explanationStatus: status as RepositoryExplanation['explanationStatus'], explanation: items,
    explanationMethod: method, explanationSummary: summary, explanationReason: textOrNull(raw.explanationReason),
    baselineSource, baselineDatasetVersion: textOrNull(raw.baselineDatasetVersion),
    missingBaselineFeatures: Array.isArray(raw.missingBaselineFeatures) ? raw.missingBaselineFeatures.map(value => text(value)) : [],
    featureSchemaVersion: textOrNull(raw.featureSchemaVersion), generatedAt: raw.generatedAt == null ? null : utcTimestamp(raw.generatedAt),
    limitations: Array.isArray(raw.limitations) ? raw.limitations.map(value => text(value)) : [],
  }
}

export function requestRepositoryExplanation(context: ExplanationContext, generate = false, signal?: AbortSignal): Promise<RepositoryExplanation> {
  const path = `/api/v1/repositories/${encodeURIComponent(context.repositoryId)}/commits/${encodeURIComponent(context.commitId)}/explanation?viewSyncId=${encodeURIComponent(context.viewSyncId)}`
  return apiRequest({ path, method: generate ? 'POST' : 'GET', signal }).then(body => parseRepositoryExplanation(body, context))
}
