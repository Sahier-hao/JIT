/**
 * 仓库工作区契约（change `add-repository-workspace` 的 5 个接口）。
 *
 * 与仓库同步作业的区别：作业是"一次采集"，仓库是"这个地址长期的状态"——
 * 最新一次作业、当前展示哪一次、有多少提交、风险怎么分布。
 *
 * 字段口径（与后端 `sync.py::_repository_view` 一致）：
 * - `distribution` 由后端按 `repo-distribution-v1` 计算：risk>=0.25 高、0.10~0.25 中、<0.10 低、空值未知；
 * - `viewSyncId` 是"当前展示的那次成功作业"，失败作业不会把它清空；
 * - 详情额外带来源模型（`modelStrategy`）、降级原因与数据局限。
 */
import { contractFailed, finiteNumber, record, recordList, text, textList, textOrNull, uuidText } from './apiContract'
import type { Commit, Query } from './domain'
import { toCommit } from './domain'
import { useEffect, useState } from 'react'
import { apiRequest } from './apiClient'
import { parseSync, parseSyncCommit, type SyncCommit, type SyncView } from './repositoryContract'

export interface RepositoryDistribution {
  high: number
  medium: number
  low: number
  unknown: number
}

export interface RepositoryView {
  repositoryId: string
  url: string
  displayName: string
  defaultBranch: string
  latestSyncId: string | null
  latestSyncAt: string | null
  viewSyncId: string | null
  headCommit: string | null
  commitCount: number
  distribution: RepositoryDistribution
  distributionRule: string
  createdAt: string
  updatedAt: string
}

export interface RepositoryDetail extends RepositoryView {
  latestSync: SyncView | null
  viewContext: AnalysisContext | null
  modelStrategy: 'repository-trained' | 'generic-model' | null
  degradeReason: 'fewRecords' | 'fewPositives' | 'noTestPositive' | 'noGenericModel' | null
  runId: string | null
  modelId: string | null
  datasetVersion: string | null
  limitations: string[]
}

export interface AnalysisContext {
  repositoryId: string; syncId: string; branch: string; completedAt: string | null
  headCommit: string | null; datasetVersion: string | null; modelId: string | null; runId: string | null
  missingMetadata: string[]
}

export interface RepositoryListPage {
  repositories: RepositoryView[]
  total: number
  limit: number
  offset: number
}

const STRATEGY_VALUES = ['repository-trained', 'generic-model'] as const
const DEGRADE_VALUES = ['fewRecords', 'fewPositives', 'noTestPositive', 'noGenericModel'] as const

function count(value: unknown): number {
  const raw = finiteNumber(value)
  if (!Number.isSafeInteger(raw) || raw < 0) contractFailed('仓库计数必须为非负整数')
  return raw
}

function distribution(value: unknown): RepositoryDistribution {
  const raw = record(value)
  return { high: count(raw.high), medium: count(raw.medium), low: count(raw.low), unknown: count(raw.unknown) }
}

export function parseRepositoryView(value: unknown): RepositoryView {
  const raw = record(value)
  return {
    repositoryId: uuidText(raw.repositoryId, '仓库标识'),
    url: text(raw.url, '仓库地址'),
    displayName: text(raw.displayName, '仓库名称'),
    defaultBranch: text(raw.defaultBranch, '默认分支'),
    latestSyncId: raw.latestSyncId == null ? null : uuidText(raw.latestSyncId, '最近同步标识'),
    latestSyncAt: raw.latestSyncAt == null ? null : text(raw.latestSyncAt, '最近同步时间'),
    viewSyncId: raw.viewSyncId == null ? null : uuidText(raw.viewSyncId, '展示同步标识'),
    headCommit: textOrNull(raw.headCommit),
    commitCount: count(raw.commitCount),
    distribution: distribution(raw.distribution),
    distributionRule: textOrNull(raw.distributionRule) ?? 'repo-distribution-v1',
    createdAt: text(raw.createdAt, '创建时间'),
    updatedAt: text(raw.updatedAt, '更新时间'),
  }
}

export function parseRepositoryDetail(value: unknown): RepositoryDetail {
  const base = parseRepositoryView(value)
  const raw = record(value)
  const strategy = raw.modelStrategy == null ? null : text(raw.modelStrategy, '打分模型来源')
  const degrade = raw.degradeReason == null ? null : text(raw.degradeReason, '降级原因')
  const context = raw.viewContext == null ? null : record(raw.viewContext)
  if (context && (context.repositoryId !== base.repositoryId || context.syncId !== base.viewSyncId)) contractFailed('成功分析来源不一致')
  return {
    ...base,
    latestSync: raw.latestSync == null ? null : parseSync(raw.latestSync),
    viewContext: context ? {
      repositoryId: uuidText(context.repositoryId, '仓库标识'), syncId: uuidText(context.syncId, '分析标识'),
      branch: text(context.branch), completedAt: textOrNull(context.completedAt), headCommit: textOrNull(context.headCommit),
      datasetVersion: textOrNull(context.datasetVersion), modelId: textOrNull(context.modelId), runId: textOrNull(context.runId),
      missingMetadata: textList(context.missingMetadata),
    } : null,
    modelStrategy: strategy !== null && (STRATEGY_VALUES as readonly string[]).includes(strategy)
      ? (strategy as RepositoryDetail['modelStrategy'])
      : null,
    degradeReason: degrade !== null && (DEGRADE_VALUES as readonly string[]).includes(degrade)
      ? (degrade as RepositoryDetail['degradeReason'])
      : null,
    runId: raw.runId == null ? null : uuidText(raw.runId, '运行标识'),
    modelId: raw.modelId == null ? null : uuidText(raw.modelId, '模型标识'),
    datasetVersion: textOrNull(raw.datasetVersion),
    limitations: raw.limitations == null ? [] : textList(raw.limitations),
  }
}

export function parseRepositoryListPage(value: unknown): RepositoryListPage {
  const raw = record(value)
  return {
    repositories: recordList(raw.repositories).map(parseRepositoryView),
    total: count(raw.total),
    limit: count(raw.limit),
    offset: count(raw.offset),
  }
}

/** 一次查询翻译成请求路径：留空的条件下不发送。 */
export function repositoryCommitsPath(repositoryId: string, query: Query, offset: number, limit: number, viewSyncId?: string): string {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sort: query.sort })
  if (query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.start !== '') params.set('start', query.start)
  if (query.end !== '') params.set('end', query.end)
  if (viewSyncId) params.set('viewSyncId', viewSyncId)
  return `/api/v1/repositories/${encodeURIComponent(repositoryId)}/commits?${params.toString()}`
}

/* ---------------------------------------------------------------------------
 * 数据加载：仓库列表、仓库详情、仓库提交分页
 *
 * 三个约束与仓库同步视图一致：没有凭据不发请求；筛选或翻页变化时中止上一个请求；
 * 服务端错误原样显示（不改写成"加载失败"）。
 * ------------------------------------------------------------------------- */

function describe(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : '读取失败，请稍后重试'
}

export interface RepositoryListLoad {
  state: 'idle' | 'loading' | 'ready' | 'error'
  items: RepositoryView[]
  total: number
  error: string
  retry: () => void
}

export function useRepositories(): RepositoryListLoad {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<RepositoryListLoad, 'retry'>>({ state: 'loading', items: [], total: 0, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      const items: RepositoryView[] = []
      let total = 0
      do {
        const page = parseRepositoryListPage(await apiRequest({ path: `/api/v1/repositories?limit=100&offset=${items.length}`, method: 'GET', signal: controller.signal }))
        if (page.offset !== items.length || (!page.repositories.length && page.total > items.length)) contractFailed('项目分页不一致，请刷新')
        total = page.total; items.push(...page.repositories)
      } while (items.length < total)
      if (new Set(items.map(item => item.repositoryId)).size !== items.length) contractFailed('项目列表重复，请刷新')
      return { items, total }
    }
    setState({ state: 'loading', items: [], total: 0, error: '' })
    load().then(result => { if (!controller.signal.aborted) setState({ state: 'ready', ...result, error: '' }) }).catch(error => { if (!controller.signal.aborted) setState({ state: 'error', items: [], total: 0, error: describe(error) }) })
    return () => controller.abort()
  }, [attempt])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}

export interface RepositoryLoad {
  state: 'idle' | 'loading' | 'ready' | 'error'
  repository: RepositoryDetail | null
  error: string
  retry: () => void
}

export function useRepository(repositoryId: string, viewSyncId?: string): RepositoryLoad {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<RepositoryLoad, 'retry'>>({ state: 'idle', repository: null, error: '' })
  useEffect(() => {
    if (repositoryId === '') return
    const controller = new AbortController()
    let active = true
    setState(previous => ({ ...previous, state: 'loading', error: '' }))
    apiRequest({ path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}${viewSyncId ? `?viewSyncId=${encodeURIComponent(viewSyncId)}` : ''}`, method: 'GET', signal: controller.signal })
      .then(parseRepositoryDetail)
      .then(repo => { if (repo.repositoryId !== repositoryId || (viewSyncId && (repo.viewSyncId !== viewSyncId || !repo.viewContext))) contractFailed('仓库分析来源不一致'); return repo })
      .then(repository => { if (active) setState({ state: 'ready', repository, error: '' }) })
      .catch(error => { if (active) setState({ state: 'error', repository: null, error: describe(error) }) })
    return () => { active = false; controller.abort() }
  }, [repositoryId, viewSyncId, attempt])
  useEffect(() => {
    if (!repositoryId || !viewSyncId) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setAttempt(value => value + 1) }, 15000)
    return () => clearInterval(timer)
  }, [repositoryId, viewSyncId])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}

export interface RepositoryCommitPage {
  state: 'idle' | 'loading' | 'ready' | 'error'
  commits: SyncCommit[]
  total: number
  viewSyncId: string | null
  error: string
  retry: () => void
}

/** 仓库提交分页：`viewSyncId` 为 null 表示这个仓库还没有可看的成功作业。 */
export function useRepositoryCommits(
  repositoryId: string,
  query: Query,
  offset: number,
  limit = 20,
  pinnedSyncId?: string,
): RepositoryCommitPage {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<RepositoryCommitPage, 'retry'>>({
    state: 'idle', commits: [], total: 0, viewSyncId: null, error: '',
  })
  const { search, start, end, sort } = query
  useEffect(() => {
    if (repositoryId === '') return
    const controller = new AbortController()
    let active = true
    setState({ state: 'loading', commits: [], total: 0, viewSyncId: null, error: '' })
    const path = repositoryCommitsPath(repositoryId, { search, start, end, sort }, offset, limit, pinnedSyncId)
    apiRequest({ path, method: 'GET', signal: controller.signal })
      .then(raw => {
        const body = record(raw)
        const viewSyncId = body.viewSyncId == null ? null : uuidText(body.viewSyncId, '展示同步标识')
        if (body.repositoryId !== repositoryId || (pinnedSyncId && pinnedSyncId !== viewSyncId)) contractFailed('提交页分析来源不一致')
        return {
          viewSyncId,
          total: count(body.total),
          commits: recordList(body.commits).map(parseSyncCommit),
        }
      })
      .then(page => { if (active) setState({ state: 'ready', ...page, error: '' }) })
      .catch(error => { if (active) setState({ state: 'error', commits: [], total: 0, viewSyncId: null, error: describe(error) }) })
    return () => { active = false; controller.abort() }
  }, [repositoryId, search, start, end, sort, offset, limit, pinnedSyncId, attempt])
  return { ...state, retry: () => setAttempt(value => value + 1) }
}

/**
 * 清单里的提交逐条取详情（仓库维度）。
 *
 * 清单是本地保存的标识集合，不属于任何一页查询；逐条请求可以确认"这条还在当前视图里"，
 * 取不到的单独列出来让用户移除，而不是悄悄从清单消失（CRR-10）。
 */
export interface RepositoryShortlist {
  state: 'idle' | 'loading' | 'ready' | 'error'
  records: Map<string, Commit>
  failed: string[]
}

const EMPTY_SHORTLIST: RepositoryShortlist = { state: 'ready', records: new Map(), failed: [] }

export function useRepositoryShortlist(repositoryId: string, ids: string[], viewSyncId?: string): RepositoryShortlist {
  const [state, setState] = useState<RepositoryShortlist>({ state: 'idle', records: new Map(), failed: [] })
  const key = ids.join(',')
  useEffect(() => {
    if (repositoryId === '' || key === '') return
    const wanted = key.split(',')
    const controller = new AbortController()
    let active = true
    setState({ state: 'loading', records: new Map(), failed: [] })
    Promise.allSettled(wanted.map(id => apiRequest({
      path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/commits/${encodeURIComponent(id)}${viewSyncId ? `?viewSyncId=${encodeURIComponent(viewSyncId)}` : ''}`,
      method: 'GET',
      signal: controller.signal,
    }).then(raw => { const body = record(raw); if (viewSyncId && (body.repositoryId !== repositoryId || body.viewSyncId !== viewSyncId)) contractFailed('提交详情来源不一致'); return parseSyncCommit(raw) }).then(toCommit)))
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
  }, [repositoryId, key, viewSyncId])
  if (repositoryId === '' || key === '') return EMPTY_SHORTLIST
  return state
}
