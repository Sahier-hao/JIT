/**
 * 仓库同步的契约层：作业视图、提交分页与失败提示（design D5/D6）。
 *
 * 与其它契约模块同一立场：形状不符不猜测、不部分采用。失败提示只把服务端错误码
 * 翻成"下一步可以做什么"，不改写服务端给出的原因——两者一起显示，便于核对。
 */

import {
  contractFailed,
  finiteNumber,
  record,
  recordList,
  riskNumber,
  text,
  textOrNull,
  utcTimestamp,
  uuidText,
} from './apiContract'

export const ACTIVE_STATUSES = ['queued', 'collecting', 'registering', 'training', 'scoring'] as const
export type SyncStatus = (typeof ACTIVE_STATUSES)[number] | 'completed' | 'failed' | 'interrupted'
export const STRATEGIES = ['auto', 'generic-model', 'force-train'] as const
export type SyncStrategy = (typeof STRATEGIES)[number]
export const STRATEGY_LABELS: Record<SyncStrategy, string> = {
  auto: '自动（按数据量给建议）',
  'generic-model': '只用现成模型',
  'force-train': '强制用本仓库数据训练',
}
export const STATUS_LABELS: Record<SyncStatus, string> = {
  queued: '排队中',
  collecting: '正在采集',
  registering: '正在登记数据',
  training: '正在训练',
  scoring: '正在打分',
  completed: '已完成',
  failed: '未完成',
  interrupted: '已中断',
}
export const DEGRADE_LABELS: Record<string, string> = {
  fewRecords: '提交数量太少，不足以训练',
  fewPositives: '能确认的缺陷引入太少，不足以训练',
  noTestPositive: '测试时间段没有正例，无法验证',
  noGenericModel: '模型目录里没有可用于该仓库数据的现成模型',
}

export interface SyncError {
  code: string
  message: string
}

export interface SyncView {
  syncId: string
  repositoryId: string | null
  repositoryUrl: string
  branch: string
  since: string | null
  until: string | null
  commitLimit: number
  requestedStrategy: SyncStrategy
  status: SyncStatus
  stage: SyncStatus
  datasetVersion: string | null
  runId: string | null
  modelId: string | null
  modelStrategy: 'repository-trained' | 'generic-model' | null
  degradeReason: string | null
  trainRecords: number | null
  trainPositives: number | null
  createdAt: string
  updatedAt: string
  requestId: string | null
  error: SyncError | null
}

export interface SyncPage {
  syncs: SyncView[]
  total: number
  limit: number
  offset: number
}

export interface SyncCommit {
  commitId: string
  epoch: number
  risk: number
  addedLines: number
  deletedLines: number
  files: number
  label: 0 | 1
  labelNote: string | null
  /** 仓库接口会带提交标题；同步作业的旧接口没有，统一为 null。 */
  subject: string | null
  authorName?: string | null
  originalCommitUrl?: string | null
  metrics: Record<string, number>
}

export interface SyncCommitPage {
  syncId: string
  status: SyncStatus
  total: number
  limit: number
  offset: number
  commits: SyncCommit[]
}

function count(value: unknown): number {
  const raw = finiteNumber(value)
  if (!Number.isSafeInteger(raw) || raw < 0) contractFailed()
  return raw
}

function countOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : count(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  const raw = text(value)
  if (!(allowed as readonly string[]).includes(raw)) contractFailed()
  return raw as T
}

function errorOf(value: unknown): SyncError | null {
  if (value === null || value === undefined) return null
  const raw = record(value)
  return { code: text(raw.code), message: text(raw.message) }
}

function measures(value: unknown): Record<string, number> {
  const raw = record(value)
  const result: Record<string, number> = {}
  for (const [name, item] of Object.entries(raw)) {
    const parsed = finiteNumber(item)
    if (parsed < 0) contractFailed()
    result[name] = parsed
  }
  return result
}

export function parseSync(value: unknown): SyncView {
  const raw = record(value)
  const modelStrategy = textOrNull(raw.modelStrategy)
  if (modelStrategy !== null && modelStrategy !== 'repository-trained' && modelStrategy !== 'generic-model') contractFailed()
  const branch = text(raw.branch)
  if (branch === '') contractFailed()
  return {
    syncId: uuidText(raw.syncId),
    repositoryId: textOrNull(raw.repositoryId),
    repositoryUrl: text(raw.repositoryUrl),
    branch,
    since: textOrNull(raw.since),
    until: textOrNull(raw.until),
    commitLimit: count(raw.commitLimit),
    requestedStrategy: oneOf(raw.requestedStrategy, STRATEGIES),
    status: oneOf(raw.status, [...ACTIVE_STATUSES, 'completed', 'failed', 'interrupted'] as const),
    stage: oneOf(raw.stage, [...ACTIVE_STATUSES, 'completed', 'failed', 'interrupted'] as const),
    datasetVersion: textOrNull(raw.datasetVersion),
    runId: textOrNull(raw.runId),
    modelId: textOrNull(raw.modelId),
    modelStrategy,
    degradeReason: textOrNull(raw.degradeReason),
    trainRecords: countOrNull(raw.trainRecords),
    trainPositives: countOrNull(raw.trainPositives),
    createdAt: utcTimestamp(raw.createdAt),
    updatedAt: utcTimestamp(raw.updatedAt),
    requestId: textOrNull(raw.requestId),
    error: errorOf(raw.error),
  }
}

export function parseSyncPage(value: unknown): SyncPage {
  const raw = record(value)
  return {
    syncs: recordList(raw.syncs).map(parseSync),
    total: count(raw.total),
    limit: count(raw.limit),
    offset: count(raw.offset),
  }
}

/** 单条提交：清单视图逐条读取详情时复用同一套校验，不另写一份形状判断。 */
export function parseSyncCommit(value: unknown): SyncCommit {
  const raw = record(value)
  const label = count(raw.label)
  if (label !== 0 && label !== 1) contractFailed()
  return {
    commitId: text(raw.commitId),
    epoch: count(raw.epoch),
    risk: riskNumber(raw.risk),
    addedLines: count(raw.addedLines),
    deletedLines: count(raw.deletedLines),
    files: count(raw.files),
    label,
    labelNote: textOrNull(raw.labelNote),
    subject: textOrNull(raw.subject),
    authorName: textOrNull(raw.authorName),
    originalCommitUrl: textOrNull(raw.originalCommitUrl),
    metrics: measures(raw.features),
  }
}

export function parseSyncCommitPage(value: unknown): SyncCommitPage {
  const raw = record(value)
  return {
    syncId: uuidText(raw.syncId),
    status: oneOf(raw.status, [...ACTIVE_STATUSES, 'completed', 'failed', 'interrupted'] as const),
    total: count(raw.total),
    limit: count(raw.limit),
    offset: count(raw.offset),
    commits: recordList(raw.commits).map(parseSyncCommit),
  }
}

/** 请求体：留空的字段不提交，由服务端取默认值（D5）。 */
export function syncBody(form: {
  repositoryUrl: string
  branch: string
  since: string
  until: string
  commitLimit: string
  strategy: SyncStrategy
}): Record<string, unknown> {
  const body: Record<string, unknown> = { repositoryUrl: form.repositoryUrl.trim(), strategy: form.strategy }
  if (form.branch.trim() !== '') body.branch = form.branch.trim()
  if (form.since.trim() !== '') body.since = form.since.trim()
  if (form.until.trim() !== '') body.until = form.until.trim()
  if (form.commitLimit.trim() !== '') body.commitLimit = Number(form.commitLimit.trim())
  return body
}

export interface FailureHint {
  title: string
  next: string
}

/** 失败码 → 人话与下一步；未登记的错误码保留服务端原文，不假装知道原因（D6）。 */
export function failHint(error: SyncError | null): FailureHint | null {
  if (error === null) return null
  switch (error.code) {
    case 'REPOSITORY_UNAVAILABLE':
      return { title: '仓库打不开或分支不存在', next: '确认地址是公开的 HTTP(S) 仓库、分支名拼写正确，或换一个仓库再试。' }
    case 'DATASET_INVALID':
      return { title: '这个范围内采不到可用的提交', next: '把日期范围放宽、把提交上限调大，或确认仓库在这个期间确实有提交。' }
    case 'SPLIT_INVALID':
      return { title: '数据无法按时间切分', next: '改用「只用现成模型」，或换成提交历史更长的仓库。' }
    case 'MODEL_NOT_READY':
      return { title: '没有可用的现成模型', next: '改用「自动」或「强制用本仓库数据训练」，或者先在模型中心登记一个六字段模型。' }
    case 'SYNC_TIMEOUT':
      return { title: '同步超时，已停止', next: '缩小日期范围或把提交上限调小，然后重新同步。' }
    case 'SYNC_INTERRUPTED':
      return { title: '服务重启打断了这次同步', next: '重新同步即可；已经登记的数据集不会因此丢失。' }
    case 'DATASET_UNAVAILABLE':
      return { title: '数据集读写失败', next: '确认后端数据目录可写，然后重新同步。' }
    case 'INPUT_INVALID':
      return { title: '输入有误', next: '按提示修正仓库地址、日期范围或提交上限后重试。' }
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
      return { title: '凭据无效或权限不足', next: '在左侧重新填入团队访问凭据。' }
    default:
      return { title: '同步未完成', next: '稍后重试；若持续失败，把下面的错误码和请求编号一并反馈。' }
  }
}

/** 仓库名：地址末段去掉 `.git`，用于界面标题与数据集名，不参与任何身份判定。 */
export function repositoryName(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  const last = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return last.endsWith('.git') ? last.slice(0, -4) : last
}
