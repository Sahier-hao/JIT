import { shanghaiDate, type Commit } from './commit'
import { validRisk } from './risk'

/** 提交列表的筛选条件：搜索词、上海日界线的起止日期、排序键。 */
export interface Query {
  search: string
  start: string
  end: string
  sort: string
}

export const emptyQuery: Query = { search: '', start: '', end: '', sort: 'risk' }

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

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
