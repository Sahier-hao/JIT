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
import { contractFailed, finiteNumber, record, recordList, text, textList, textOrNull, uuidText } from './api/primitives'
import type { Commit, Query } from './domain'
import { toCommit } from './domain'
import { useEffect, useState } from 'react'
import { useAsync, type AsyncStatus } from './hooks/useAsync'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import { apiRequest } from './api/client'
import { parseSync, parseSyncCommit, type SyncCommit, type SyncView } from './api/repositories'

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
 * 统一走 useAsync：中止上一个请求、刷新时保留旧数据、轮询只在这一处实现。
 * 三个约束与仓库同步视图一致：没有凭据不发请求；筛选或翻页变化时中止上一个请求；
 * 服务端错误原样显示（不改写成"加载失败"）。
 * ------------------------------------------------------------------------- */

export interface RepositoryListLoad {
  state: AsyncStatus
  items: RepositoryView[]
  total: number
  error: string
  retry: () => void
}

interface RepositoryIndex {
  items: RepositoryView[]
  total: number
}

export function useRepositories(): RepositoryListLoad {
  const { status, data, error, retry } = useAsync<RepositoryIndex>({
    key: 'repositories',
    run: async signal => {
      const seen = new Map<string, RepositoryView>()
      let total = 0
      let cursor = 0
      for (;;) {
        const page = parseRepositoryListPage(await apiRequest({ path: `/api/v1/repositories?limit=100&offset=${cursor}`, method: 'GET', signal }))
        if (page.offset !== cursor) contractFailed('项目分页不一致，请刷新')
        total = page.total
        if (page.repositories.length === 0) break
        // 按 id 去重：同一仓库重复出现时不再整页失败，只以最近一次为准。
        for (const item of page.repositories) seen.set(item.repositoryId, item)
        cursor += page.repositories.length
        if (cursor >= total) break
      }
      if (seen.size !== total) contractFailed('项目分页不一致，请刷新')
      return { items: [...seen.values()], total }
    },
  })
  return { state: status, items: data?.items ?? [], total: data?.total ?? 0, error, retry }
}

export interface RepositoryLoad {
  state: AsyncStatus
  repository: RepositoryDetail | null
  error: string
  retry: () => void
}

export function useRepository(repositoryId: string, viewSyncId?: string): RepositoryLoad {
  const identity = `${repositoryId}|${viewSyncId ?? ''}`
  const { status, data, error, retry } = useAsync<RepositoryDetail>({
    key: repositoryId === '' ? null : identity,
    keepPrevious: true,
    resetKey: identity,
    // 只有固定的成功分析才轮询：它可能在后台补数据，但换的是同一身份。
    pollMs: viewSyncId ? 15000 : undefined,
    run: async signal => {
      const path = `/api/v1/repositories/${encodeURIComponent(repositoryId)}${viewSyncId ? `?viewSyncId=${encodeURIComponent(viewSyncId)}` : ''}`
      const repository = parseRepositoryDetail(await apiRequest({ path, method: 'GET', signal }))
      if (repository.repositoryId !== repositoryId || (viewSyncId && (repository.viewSyncId !== viewSyncId || !repository.viewContext))) contractFailed('仓库分析来源不一致')
      return repository
    },
  })
  return { state: status, repository: data ?? null, error, retry }
}

export interface RepositoryCommitPage {
  state: AsyncStatus
  commits: SyncCommit[]
  total: number
  viewSyncId: string | null
  error: string
  retry: () => void
}

interface CommitPage {
  commits: SyncCommit[]
  total: number
  viewSyncId: string | null
}

/** 仓库提交分页：`viewSyncId` 为 null 表示这个仓库还没有可看的成功作业。 */
export function useRepositoryCommits(
  repositoryId: string,
  query: Query,
  offset: number,
  limit = 20,
  pinnedSyncId?: string,
): RepositoryCommitPage {
  // 搜索防抖：只有停止输入 250ms 后才换请求身份，翻页和日期筛选立即生效。
  const search = useDebouncedValue(query.search.trim(), 250)
  const identity = `${repositoryId}|${pinnedSyncId ?? ''}`
  const queryKey = `${search}|${query.start}|${query.end}|${query.sort}|${offset}|${limit}`
  const { status, data, error, retry } = useAsync<CommitPage>({
    key: repositoryId === '' ? null : `${identity}|${queryKey}`,
    // 翻页/改筛选时保留上一页：表格不闪空，失败也能看到旧结果。
    keepPrevious: true,
    resetKey: identity,
    run: async signal => {
      const path = repositoryCommitsPath(repositoryId, { search, start: query.start, end: query.end, sort: query.sort }, offset, limit, pinnedSyncId)
      const body = record(await apiRequest({ path, method: 'GET', signal }))
      const viewSyncId = body.viewSyncId == null ? null : uuidText(body.viewSyncId, '展示同步标识')
      if (body.repositoryId !== repositoryId || (pinnedSyncId && pinnedSyncId !== viewSyncId)) contractFailed('提交页分析来源不一致')
      return { commits: recordList(body.commits).map(parseSyncCommit), total: count(body.total), viewSyncId }
    },
  })
  return { state: status, commits: data?.commits ?? [], total: data?.total ?? 0, viewSyncId: data?.viewSyncId ?? null, error, retry }
}

/**
 * 清单里的提交逐条取详情（仓库维度）。
 *
 * 清单是本地保存的标识集合，不属于任何一页查询；逐条请求可以确认"这条还在当前视图里"，
 * 取不到的单独列出来让用户移除，而不是悄悄从清单消失（CRR-10）。
 *
 * 详情按「仓库 + 分析 + 提交」缓存：清单、详情、预览共用同一份，来回切换不重复请求。
 */
export interface RepositoryShortlist {
  state: AsyncStatus
  records: Map<string, Commit>
  failed: string[]
}

const EMPTY_SHORTLIST: RepositoryShortlist = { state: 'ready', records: new Map(), failed: [] }
const DETAIL_CACHE_LIMIT = 2000
const detailCache = new Map<string, Commit>()

function detailKey(repositoryId: string, viewSyncId: string | undefined, commitId: string): string {
  return `${repositoryId}|${viewSyncId ?? ''}|${commitId}`
}

function cached(repositoryId: string, viewSyncId: string | undefined, ids: readonly string[]): Map<string, Commit> {
  const records = new Map<string, Commit>()
  for (const commitId of ids) {
    const commit = detailCache.get(detailKey(repositoryId, viewSyncId, commitId))
    if (commit) records.set(commitId, commit)
  }
  return records
}

export function useRepositoryShortlist(repositoryId: string, ids: string[], viewSyncId?: string): RepositoryShortlist {
  const key = ids.join(',')
  const [state, setState] = useState<RepositoryShortlist>(() => ({
    state: ids.length ? 'loading' : 'idle',
    records: cached(repositoryId, viewSyncId, ids),
    failed: [],
  }))
  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',')
    if (repositoryId === '' || wanted.length === 0) return
    const missing = wanted.filter(commitId => !detailCache.has(detailKey(repositoryId, viewSyncId, commitId)))
    if (missing.length === 0) {
      setState({ state: 'ready', records: cached(repositoryId, viewSyncId, wanted), failed: [] })
      return
    }
    const controller = new AbortController()
    let active = true
    setState({ state: 'loading', records: cached(repositoryId, viewSyncId, wanted), failed: [] })
    Promise.allSettled(missing.map(commitId => apiRequest({
      path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/commits/${encodeURIComponent(commitId)}${viewSyncId ? `?viewSyncId=${encodeURIComponent(viewSyncId)}` : ''}`,
      method: 'GET',
      signal: controller.signal,
    }).then(raw => {
      const body = record(raw)
      if (viewSyncId && (body.repositoryId !== repositoryId || body.viewSyncId !== viewSyncId)) contractFailed('提交详情来源不一致')
      return parseSyncCommit(raw)
    }).then(toCommit))).then(results => {
      if (!active) return
      const failed: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') detailCache.set(detailKey(repositoryId, viewSyncId, result.value.id), result.value)
        else failed.push(missing[index])
      })
      while (detailCache.size > DETAIL_CACHE_LIMIT) {
        const oldest = detailCache.keys().next()
        if (oldest.done) break
        detailCache.delete(oldest.value)
      }
      setState({ state: 'ready', records: cached(repositoryId, viewSyncId, wanted), failed })
    })
    return () => { active = false; controller.abort() }
  }, [repositoryId, key, viewSyncId])
  if (repositoryId === '' || key === '') return EMPTY_SHORTLIST
  return state
}
