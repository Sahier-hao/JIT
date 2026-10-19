import type { BaselineSummary, Mode } from './historicalContract'
import { parseSync, parseSyncCommitPage, repositoryName, type SyncCommit } from './repositoryContract'
export { parseHistorical } from './historicalContract'
export type { BaselineSummary, Mode, Score } from './historicalContract'
export interface Commit { id: string; time: string; risk?: unknown; lines?: number; files?: number; title?: string; authorName?: string | null; originalCommitUrl?: string | null; metrics?: Record<string, number>; explanation?: string[] }
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
export interface Dataset { mode: Mode; project: string; version: string; records: Commit[]; total?: number; repository?: RepositoryMeta; runId?: string; model?: { id: string; name: string; sha256: string }; summary?: BaselineSummary }
export function contextKey(data: Dataset): string { return JSON.stringify([data.mode, data.project, data.version, data.runId ?? '', data.repository?.syncId ?? '']) }
export interface Query { search: string; start: string; end: string; sort: string }
export const emptyQuery: Query = { search: '', start: '', end: '', sort: 'risk' }
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('数据格式无效')
  return input as Record<string, unknown>
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
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

export function validRisk(risk: unknown): risk is number {
  return typeof risk === 'number' && Number.isFinite(risk) && risk >= 0 && risk <= 1
}

export function riskLabel(risk: unknown): string {
  if (risk == null) return '暂无预测'
  return validRisk(risk) ? risk.toFixed(2) : '风险数据无效'
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
export function shanghaiDate(time: string): string { return dateFormatter.format(new Date(time)) }
const timeFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export function displayTime(time: string): string { return timeFormatter.format(new Date(time)) }

export function queryCommits(records: Commit[], query: Query): Commit[] {
  const search = query.search.trim().toLowerCase()
  return records.filter(record => {
    if (!record.id.toLowerCase().includes(search)) return false
    if (!query.start && !query.end) return true
    const date = shanghaiDate(record.time)
    return (!query.start || date >= query.start) && (!query.end || date <= query.end)
  }).sort((a, b) => {
    if (query.sort === 'risk') {
      if (validRisk(a.risk) && validRisk(b.risk) && a.risk !== b.risk) return b.risk - a.risk
      if (validRisk(a.risk) !== validRisk(b.risk)) return validRisk(a.risk) ? -1 : 1
    }
    return Date.parse(b.time) - Date.parse(a.time) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

export function applyQuery(previous: Query, next: Query): { query: Query; error: string } {
  if ((next.start && !validDate(next.start)) || (next.end && !validDate(next.end)) || (next.start && next.end && next.start > next.end)) return { query: previous, error: '请修正日期范围：起始日期不能晚于结束日期，日期须有效。' }
  return { query: next, error: '' }
}

/**
 * 地址上的日期查询种子（CRR-05）：合法时作为工作台的初始筛选，非法时**整体忽略**并告知，
 * 不交换起止、不截断其中一端。只认 `start`／`end` 两个键，其余查询参数一律忽略。
 */
export function readSeedQuery(search: string): { query: Query; ignored: boolean } {
  const params = new URLSearchParams(search)
  const start = (params.get('start') ?? '').trim()
  const end = (params.get('end') ?? '').trim()
  if (start === '' && end === '') return { query: emptyQuery, ignored: false }
  const invalid = (start !== '' && !validDate(start)) || (end !== '' && !validDate(end)) || (start !== '' && end !== '' && start > end)
  if (invalid) return { query: emptyQuery, ignored: true }
  return { query: { ...emptyQuery, start, end }, ignored: false }
}

/**
 * 同步提交 → 工作台记录：只做字段改名与单位换算，风险与度量原样带过来。
 * 列表页、清单逐条读取与数据集解析共用这一个映射，避免三处各写一遍。
 */
export function toCommit(commit: SyncCommit): Commit {
  return {
    id: commit.commitId,
    time: new Date(commit.epoch * 1000).toISOString(),
    risk: commit.risk,
    lines: commit.addedLines + commit.deletedLines,
    files: commit.files,
    title: commit.subject ?? '',
    authorName: commit.authorName,
    originalCommitUrl: commit.originalCommitUrl,
    metrics: commit.metrics,
  }
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
