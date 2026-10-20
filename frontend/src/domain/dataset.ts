import type { BaselineSummary } from '../api/historical'
import { parseSync, parseSyncCommitPage, repositoryName } from '../api/repositories'
import { toCommit, type Commit } from './commit'
import { validDate } from './query'
import type { Mode } from './types'

/** 仓库来源的上下文：同步作业身份与它实际采用的打分模型，供界面如实标注来源（RCL-08/09）。 */
export interface RepositoryMeta {
  repositoryId?: string
  syncId: string
  repositoryUrl: string
  branch: string
  datasetVersion: string | null
  requestedStrategy: string
  modelStrategy: string | null
  degradeReason: string | null
  trainRecords: number | null
  trainPositives: number | null
  labelNote: string
}

export interface Dataset {
  mode: Mode
  project: string
  version: string
  records: Commit[]
  total?: number
  repository?: RepositoryMeta
  runId?: string
  model?: { id: string; name: string; sha256: string }
  summary?: BaselineSummary
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('数据格式无效')
  return input as Record<string, unknown>
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function parseDataset(input: unknown): Dataset {
  const raw = object(input)
  if (raw.mode !== undefined && raw.mode !== 'demo') throw new Error('演示来源模式不匹配')
  if (typeof raw.project !== 'string' || !raw.project.trim() || typeof raw.version !== 'string' || !raw.version.trim()) throw new Error('必需来源信息不完整')
  if (!Array.isArray(raw.records)) throw new Error('提交集合格式无效')
  const seen = new Set<string>()
  const records = raw.records.map((item): Commit => {
    const entry = object(item)
    if (typeof entry.id !== 'string' || !entry.id.trim()) throw new Error('提交标识无效')
    const id = entry.id.trim()
    if (seen.has(id)) throw new Error('提交标识重复')
    seen.add(id)
    if (typeof entry.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.time) || !validDate(entry.time.slice(0, 10)) || !Number.isFinite(Date.parse(entry.time))) throw new Error('提交时间无效或缺少时区')
    const metrics = entry.metrics && typeof entry.metrics === 'object' && !Array.isArray(entry.metrics)
      ? Object.fromEntries(Object.entries(entry.metrics).filter((pair): pair is [string, number] => typeof pair[1] === 'number' && Number.isFinite(pair[1]))) : undefined
    return {
      id, time: entry.time, risk: entry.risk, lines: optionalCount(entry.lines), files: optionalCount(entry.files),
      title: typeof entry.title === 'string' ? entry.title : undefined,
      metrics,
      explanation: Array.isArray(entry.explanation) ? entry.explanation.filter((value): value is string => typeof value === 'string' && !!value.trim()) : undefined,
    }
  })
  return { mode: 'demo', project: raw.project.trim(), version: raw.version.trim(), records }
}

/**
 * 仓库来源的数据集（RCL-08）：只展示本次同步实际打分的提交。
 *
 * 与历史回放不同，这里没有发布者的标签质量与冻结指标——提交的 0/1 标签来自简化 SZZ，
 * 只作为"观测到引入过缺陷"的线索展示，不当作评价结论。`records` 是首屏一页（按风险降序），
 * `total` 是该作业的提交总数；工作台列表本身按服务端分页读取，不依赖这里的 records。
 */
export function parseRepository(input: unknown): Dataset {
  const raw = object(input)
  const sync = parseSync(raw.sync)
  const page = parseSyncCommitPage(raw.page)
  if (sync.syncId !== page.syncId) throw new Error('同步作业身份不一致')
  const records = page.commits.map(toCommit)
  return {
    mode: 'repository',
    project: repositoryName(sync.repositoryUrl),
    version: sync.datasetVersion ?? '未登记数据集',
    total: page.total,
    records,
    runId: sync.runId ?? undefined,
    repository: {
      repositoryId: sync.repositoryId ?? undefined,
      syncId: sync.syncId,
      repositoryUrl: sync.repositoryUrl,
      branch: sync.branch,
      datasetVersion: sync.datasetVersion,
      requestedStrategy: sync.requestedStrategy,
      modelStrategy: sync.modelStrategy,
      degradeReason: sync.degradeReason,
      trainRecords: sync.trainRecords,
      trainPositives: sync.trainPositives,
      labelNote: page.commits.find(commit => commit.labelNote)?.labelNote ?? '',
    },
  }
}
