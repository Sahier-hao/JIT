import type { BaselineSummary, Mode } from './historicalContract'
export { parseHistorical } from './historicalContract'
export type { BaselineSummary, Mode, Score } from './historicalContract'
export interface Commit { id: string; time: string; risk?: unknown; lines?: number; files?: number; title?: string; metrics?: Record<string, number>; explanation?: string[] }
export interface Dataset { mode: Mode; project: string; version: string; records: Commit[]; runId?: string; model?: { id: string; name: string; sha256: string }; summary?: BaselineSummary }
export function contextKey(data: Dataset): string { return JSON.stringify([data.mode, data.project, data.version, data.runId ?? '']) }
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
  return validRisk(risk) ? `${Number((risk * 100).toFixed(1))}%` : '风险数据无效'
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
