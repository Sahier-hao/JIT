import type { TrainingExperimentComparison, TrainingExperimentMethodResult } from '@/features/admin/adminContracts'
import { apiRequest } from '@/lib/apiClient'
import { contractFailed, finiteNumber, record, recordList, riskNumber, text, textOrNull } from '@/lib/apiContract'

export const CLASSIFICATION_METRICS = [['precision', '精确率'], ['recall', '召回率'], ['f1', 'F1']] as const
export type ClassificationMetric = typeof CLASSIFICATION_METRICS[number][0]

export type ThresholdSelection =
  | { strategy: 'fixed'; threshold: number }
  | { strategy: 'max-f1' }
  | { strategy: 'target-recall'; targetRecall: number }
export type ThresholdRequest = ThresholdSelection & { taskIds: [string] | [string, string] }

function counts(value: unknown, max: number): value is number[] {
  return Array.isArray(value) && value.length === 101
    && value.every(count => Number.isInteger(count) && count >= 0 && count <= max)
}

export function parseTrainingThresholdPreview(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const { positives, negatives, defaultThreshold, truePositives, falsePositives } = raw as Record<string, unknown>
  if (typeof positives !== 'number' || !Number.isInteger(positives) || positives < 0
    || typeof negatives !== 'number' || !Number.isInteger(negatives) || negatives < 0
    || positives + negatives === 0 || typeof defaultThreshold !== 'number'
    || defaultThreshold < 0 || defaultThreshold > 1 || !Number.isFinite(defaultThreshold)
    || !counts(truePositives, positives) || !counts(falsePositives, negatives)) return null
  return { positives, negatives, defaultTick: Math.round(defaultThreshold * 100), truePositives, falsePositives }
}

export type ThresholdPreview = NonNullable<ReturnType<typeof parseTrainingThresholdPreview>>
export type ThresholdCandidate = { method: TrainingExperimentMethodResult; preview: ThresholdPreview }

export function thresholdCandidate(method: TrainingExperimentMethodResult): ThresholdCandidate | null {
  const validation = method.metricsByPartition?.validation as { thresholdPreview?: unknown } | undefined
  const preview = parseTrainingThresholdPreview(validation?.thresholdPreview)
  return method.status === 'succeeded' && preview ? { method, preview } : null
}

function count(raw: unknown) {
  const value = finiteNumber(raw)
  if (!Number.isSafeInteger(value) || value < 0) contractFailed()
  return value
}

function classification(raw: unknown) {
  const body = record(raw)
  const counts = record(body.confusion)
  function metric(name: ClassificationMetric) {
    const entry = record(body[name])
    return { value: entry.value === null ? null : riskNumber(entry.value), reason: textOrNull(entry.reason) }
  }
  return {
    precision: metric('precision'), recall: metric('recall'), f1: metric('f1'),
    confusion: { tp: count(counts.tp), fp: count(counts.fp), tn: count(counts.tn), fn: count(counts.fn) },
  }
}

function evaluatedMethod(raw: unknown) {
    const method = record(raw)
    const evaluationRaw = method.evaluation == null ? null : record(method.evaluation)
    const partition = evaluationRaw?.partition == null ? null : record(evaluationRaw.partition)
    const labelPolicy = evaluationRaw?.labelPolicy == null ? null : record(evaluationRaw.labelPolicy)
    const excluded = labelPolicy?.excludedCounts == null ? null : record(labelPolicy.excludedCounts)
    const samples = evaluationRaw?.sampleCounts == null ? null : record(evaluationRaw.sampleCounts)
  return {
    taskId: text(method.taskId), artifactRunId: text(method.artifactRunId),
    runId: textOrNull(method.runId), modelId: textOrNull(method.modelId), method: text(method.method),
    threshold: riskNumber(method.threshold), defaultThreshold: riskNumber(method.defaultThreshold),
    validation: classification(method.validation), test: classification(method.test),
    defaultTest: classification(method.defaultTest),
    evaluation: evaluationRaw && partition && labelPolicy && excluded && samples ? {
      format: text(evaluationRaw.format),
      source: text(evaluationRaw.source),
      mode: evaluationRaw.mode === 'formal' ? 'formal' as const : 'exploratory' as const,
      formalAvailable: evaluationRaw.formalAvailable === true,
      formalUnavailableReason: textOrNull(evaluationRaw.formalUnavailableReason),
      partition: {
        kind: text(partition.kind),
        memberSha256: textOrNull(partition.memberSha256),
        labelSnapshot: partition.labelSnapshot === true,
      },
      labelPolicy: {
        version: text(labelPolicy.version),
        included: Array.isArray(labelPolicy.included) ? labelPolicy.included.map(value => text(value)) : [],
        excludedCounts: Object.fromEntries(
          Object.entries(excluded).map(([key, value]) => [key, finiteNumber(value)]),
        ),
      },
      sampleCounts: {
        included: finiteNumber(samples.included),
        positives: finiteNumber(samples.positives),
        negatives: finiteNumber(samples.negatives),
        excluded: finiteNumber(samples.excluded),
      },
    } : null,
  }
}

export interface ThresholdEvaluation {
  format: 'training-threshold-evaluation-v1'
  experimentId: string
  datasetVersion: string
  manifestSha256: string
  splitMemberSha256: string
  selection: ThresholdSelection
  methods: ReturnType<typeof evaluatedMethod>[]
}

export async function fetchThresholdEvaluation(
  comparison: TrainingExperimentComparison, scope: 'admin' | 'user', request: ThresholdRequest, signal: AbortSignal,
): Promise<ThresholdEvaluation> {
  const path = scope === 'user' ? '/api/v1/user/training-experiments' : '/api/v1/training-experiments'
  const body = record(await apiRequest({
    path: `${path}/${encodeURIComponent(comparison.experimentId)}/comparison/thresholds`,
    method: 'POST', body: request, signal,
  }))
  const methods = recordList(body.methods).map(evaluatedMethod)
  const selection = record(body.selection)
  const splitMemberSha256 = text(body.splitMemberSha256)
  const sameSelection = selection.strategy === request.strategy
    && (request.strategy !== 'fixed' || selection.threshold === request.threshold)
    && (request.strategy !== 'target-recall' || selection.targetRecall === request.targetRecall)
  if (body.format !== 'training-threshold-evaluation-v1' || body.experimentId !== comparison.experimentId
    || body.datasetVersion !== comparison.datasetVersion || body.manifestSha256 !== comparison.manifestSha256
    || !sameSelection || methods.length !== request.taskIds.length
    || methods.some((method, index) => {
      const original = comparison.methods.find(row => row.taskId === request.taskIds[index])
      return original?.taskId !== method.taskId || original.artifactRunId !== method.artifactRunId
        || original.splitMemberSha256 !== splitMemberSha256
    })) contractFailed('测试结果的训练运行或评估条件与当前选择不一致')
  return {
    format: body.format, experimentId: comparison.experimentId, datasetVersion: comparison.datasetVersion,
    manifestSha256: comparison.manifestSha256, splitMemberSha256, selection: selection as ThresholdSelection, methods,
  }
}

export function comparisonExportText(comparison: TrainingExperimentComparison, thresholdEvaluation?: ThresholdEvaluation): string {
  return JSON.stringify(thresholdEvaluation ? { ...comparison, thresholdEvaluation } : comparison, null, 2)
}
