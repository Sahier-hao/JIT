import { useEffect, useState } from 'react'
import { apiRequest } from './apiClient'
import { parseSyncCommit, parseSyncCommitPage, type SyncCommit } from './repositoryContract'
import { toCommit, type Commit, type Query } from './domain'

/**
 * 仓库提交的服务端分页（任务 6.4）。
 *
 * 与历史回放不同，一次同步可能有上千个提交，不能像 `/api/review-batch` 那样整包取回再在浏览器里筛。
 * 这里把搜索、日期与排序原样交给服务端：`/api/v1/repository-syncs/{id}/commits` 按同一套
 * 排序键（风险降序 → 时间降序 → 标识升序）返回一页与总数，界面只负责翻页与显示。
 *
 * 三个约束：
 * - 请求带成员凭据；没有凭据时不发请求（`state: 'idle'`），由上层显示"需要凭据"。
 * - 筛选或翻页变化时中止上一个请求，避免慢响应覆盖新结果。
 * - 一页最多 200 条（服务端上限），默认取 50 条，保证首屏与键盘操作都够快。
 */
export interface CommitPage {
  state: 'idle' | 'loading' | 'ready' | 'error'
  commits: SyncCommit[]
  total: number
  error: string
}

const IDLE: CommitPage = { state: 'idle', commits: [], total: 0, error: '' }

/** 把一次查询翻译成请求路径：留空的条件下不发送，排序与分页总是带上。 */
export function commitPagePath(syncId: string, query: Query, offset: number, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: query.sort })
  if (query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.start !== '') params.set('start', query.start)
  if (query.end !== '') params.set('end', query.end)
  return `/api/v1/repository-syncs/${encodeURIComponent(syncId)}/commits?${params.toString()}`
}

function describe(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : '提交读取失败，请稍后重试'
}

export type CommitPageLoad = CommitPage & { retry: () => void }

export function useCommitPage(syncId: string, token: string, query: Query, offset: number, limit = 50): CommitPageLoad {
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState<CommitPage>(IDLE)
  const inactive = syncId === '' || token === ''
  const { search, start, end, sort } = query
  useEffect(() => {
    if (syncId === '' || token === '') return
    const controller = new AbortController()
    let active = true
    setPage(previous => ({ state: 'loading', commits: previous.commits, total: previous.total, error: '' }))
    const path = commitPagePath(syncId, { search, start, end, sort }, offset, limit)
    apiRequest({ path, method: 'GET', token, signal: controller.signal })
      .then(parseSyncCommitPage)
      .then(result => { if (active) setPage({ state: 'ready', commits: result.commits, total: result.total, error: '' }) })
      .catch(error => { if (active) setPage({ state: 'error', commits: [], total: 0, error: describe(error) }) })
    return () => { active = false; controller.abort() }
  }, [syncId, token, search, start, end, sort, offset, limit, attempt])
  return { ...(inactive ? IDLE : page), retry: () => setAttempt(value => value + 1) }
}

/**
 * 清单里的提交逐条取详情。
 *
 * 清单是本地保存的标识集合，不属于任何一页查询，所以不能拿列表接口按页取。
 * 逐条请求可以确认"这条提交是否还在这次同步里"：取不到的标为 `failed`，
 * 界面显示可移除提示，而不是悄悄从清单里消失。
 */
export interface ShortlistRecords {
  state: 'idle' | 'loading' | 'ready' | 'error'
  records: Map<string, Commit>
  failed: string[]
}

export function useShortlistRecords(syncId: string, token: string, ids: string[]): ShortlistRecords {
  const [state, setState] = useState<ShortlistRecords>({ state: 'idle', records: new Map(), failed: [] })
  const key = ids.join(',')
  const inactive = syncId === '' || token === '' || ids.length === 0
  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',')
    if (syncId === '' || token === '' || wanted.length === 0) return
    const controller = new AbortController()
    let active = true
    setState({ state: 'loading', records: new Map(), failed: [] })
    Promise.allSettled(wanted.map(id => apiRequest({
      path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}/commits/${encodeURIComponent(id)}`,
      method: 'GET',
      token,
      signal: controller.signal,
    }).then(parseSyncCommit).then(toCommit)))
      .then(results => {
        if (!active) return
        const records = new Map<string, Commit>()
        const failed: string[] = []
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') records.set(result.value.id, result.value)
          else failed.push(wanted[index])
        })
        setState({ state: 'ready', records, failed })
      })
      .catch(() => { if (active) setState({ state: 'error', records: new Map(), failed: wanted }) })
    return () => { active = false; controller.abort() }
  }, [syncId, token, key])
  return inactive ? READY : state
}

const READY: ShortlistRecords = { state: 'ready', records: new Map(), failed: [] }
