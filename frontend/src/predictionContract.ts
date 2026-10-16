/**
 * 单条特征预测的契约解析：只解析既有 POST /api/v1/predictions 与
 * GET /api/v1/prediction-batches/{batchId} 的正文。
 *
 * 创建响应必须与本次提交的快照一致（模型、项目、记录身份与六项原始值），否则这次提交
 * 只能按「未能确认保存结果」处理——成功页不展示任何未经核对的风险数字。
 */

import {
  contractFailed,
  finiteNumber,
  hexDigest,
  record,
  recordList,
  riskNumber,
  text,
  textList,
  textOrNull,
  utcTimestamp,
  uuidText,
} from './apiContract'
import { type ModelEntry, parseModelEntry } from './catalogContract'

const CREATE_MESSAGE = '预测结果不符合约定，未确认保存结果'
const BATCH_MESSAGE = '预测结果不符合约定，未展示该批次'
export const SIX_FIELD_SCHEMA = 'openstack-six-v1'

export interface Submission {
  modelId: string
  project: string
  recordId: string
  features: Record<string, number>
  commitId: string | null
  time: string | null
}

export interface PredictionRecord {
  predictionId: string
  recordId: string
  features: Record<string, number>
  commitId: string | null
  time: string | null
  risk: number
  explanationStatus: string
  explanationReason: string
}

export interface PredictionResult {
  mode: string
  sourceKind: string
  batchId: string
  project: string
  runId: string
  model: ModelEntry
  featureSchemaVersion: string
  inputSha256: string
  createdAt: string
  records: PredictionRecord[]
  limitations: string[]
}

function featuresOf(value: unknown, names: string[], message: string): Record<string, number> {
  const raw = record(value, message)
  const keys = Object.keys(raw).sort()
  const expected = [...names].sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    contractFailed(message)
  }
  const result: Record<string, number> = {}
  for (const name of names) result[name] = finiteNumber(raw[name], message)
  return result
}

function parsePredictionRecord(value: unknown, names: string[], message: string): PredictionRecord {
  const raw = record(value, message)
  const explanationStatus = text(raw.explanationStatus, message)
  const explanationReason = text(raw.explanationReason, message)
  return {
    predictionId: uuidText(raw.predictionId, message),
    recordId: text(raw.recordId, message),
    features: featuresOf(raw.features, names, message),
    commitId: textOrNull(raw.commitId, message),
    time: textOrNull(raw.time, message),
    risk: riskNumber(raw.risk, message),
    explanationStatus,
    explanationReason,
  }
}

function sameInstant(left: string, right: string): boolean {
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}

function checkSubmission(result: PredictionResult, submission: Submission, message: string): void {
  if (result.model.modelId !== submission.modelId) contractFailed(message)
  if (result.project !== submission.project.trim()) contractFailed(message)
  const record = result.records[0]
  if (record.recordId !== submission.recordId.trim()) contractFailed(message)
  for (const [name, value] of Object.entries(submission.features)) {
    if (record.features[name] !== value) contractFailed(message)
  }
  const submittedCommit = submission.commitId?.toLowerCase() ?? null
  if (submittedCommit === null ? record.commitId !== null : record.commitId !== submittedCommit) {
    contractFailed(message)
  }
  if (submission.time === null) {
    if (record.time !== null) contractFailed(message)
  } else if (record.time === null || !sameInstant(record.time, submission.time)) {
    contractFailed(message)
  }
}

function parseResult(
  input: unknown,
  message: string,
  options: { batchId?: string; submission?: Submission },
): PredictionResult {
  const raw = record(input, message)
  const model = parseModelEntry(raw.model)
  const result: PredictionResult = {
    mode: text(raw.mode, message),
    sourceKind: text(raw.sourceKind, message),
    batchId: uuidText(raw.batchId, message),
    project: text(raw.project, message),
    runId: uuidText(raw.runId, message),
    model,
    featureSchemaVersion: text(raw.featureSchemaVersion, message),
    inputSha256: hexDigest(raw.inputSha256, message),
    createdAt: utcTimestamp(raw.createdAt, message),
    records: recordList(raw.records, message).map((item) =>
      parsePredictionRecord(item, model.featureSchema.inModel, message),
    ),
    limitations: textList(raw.limitations, message),
  }
  if (options.batchId !== undefined && result.batchId !== options.batchId) contractFailed(message)
  return result
}

/** 创建响应：单条记录、来源为调用方提供的特征、且与本次提交快照逐项一致。 */
export function parseCreatedPrediction(input: unknown, submission: Submission): PredictionResult {
  const result = parseResult(input, CREATE_MESSAGE, { submission })
  if (result.mode !== 'feature-input') contractFailed(CREATE_MESSAGE)
  if (result.sourceKind !== 'client-features') contractFailed(CREATE_MESSAGE)
  if (result.featureSchemaVersion !== SIX_FIELD_SCHEMA) contractFailed(CREATE_MESSAGE)
  if (result.records.length !== 1) contractFailed(CREATE_MESSAGE)
  if (result.model.state !== 'ready') contractFailed(CREATE_MESSAGE)
  if (!result.model.jsonPredictionSupported) contractFailed(CREATE_MESSAGE)
  checkSubmission(result, submission, CREATE_MESSAGE)
  return result
}

/** 重开响应：只核对路由中的批次身份，不要求该模型此刻仍可用或不支持预测。 */
export function parseBatchPrediction(input: unknown, batchId: string): PredictionResult {
  const result = parseResult(input, BATCH_MESSAGE, { batchId })
  if (result.records.length !== 1) contractFailed(BATCH_MESSAGE)
  return result
}

/** 客户端侧的批次编号校验：只在形如规范 UUID 时才发起查询。 */
export function normalizedBatchId(value: string): string | null {
  const raw = value.trim().toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw) ? raw : null
}
