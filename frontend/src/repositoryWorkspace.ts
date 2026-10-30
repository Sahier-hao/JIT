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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest } from './apiClient'
import { parseSync, parseSyncCommit, type SyncCommit, type SyncView } from './repositoryContract'
import { PROJECTS_CHANGED } from './projectEvents'

export interface RepositoryDistribution {
  high: number
  medium: number
  low: number
  unknown: number
}

export interface RepositoryView {
  latestSync?: SyncView | null
  repositoryId: string
  url: string
  displayName: string
  defaultBranch: string | null
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
  sourceKind?: string | null
  sourceSnapshotId?: string | null
  featureSchemaVersion?: string | null
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
    defaultBranch: textOrNull(raw.defaultBranch, '默认分支'),
    latestSyncId: raw.latestSyncId == null ? null : uuidText(raw.latestSyncId, '最近同步标识'),
    latestSyncAt: raw.latestSyncAt == null ? null : text(raw.latestSyncAt, '最近同步时间'),
    latestSync: raw.latestSync == null ? null : parseSync(raw.latestSync),
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
      sourceKind: textOrNull(context.sourceKind), sourceSnapshotId: textOrNull(context.sourceSnapshotId), featureSchemaVersion: textOrNull(context.featureSchemaVersion),
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
  useRepositoryInvalidation()
  const query = useQuery({
    queryKey: ['repositories'],
    queryFn: async ({ signal }) => {
      const items: RepositoryView[] = []
      let total = 0
      do {
        const page = parseRepositoryListPage(await apiRequest({ path: `/api/v1/repositories?limit=100&offset=${items.length}`, method: 'GET', signal }))
        if (page.offset !== items.length || (!page.repositories.length && page.total > items.length)) contractFailed('项目分页不一致，请刷新')
        total = page.total; items.push(...page.repositories)
      } while (items.length < total)
      if (new Set(items.map(item => item.repositoryId)).size !== items.length) contractFailed('项目列表重复，请刷新')
      return { items, total }
    },
  })
  return {
    state: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    error: query.error ? describe(query.error) : '',
    retry: () => { void query.refetch() },
  }
}

/** 项目增删改后让列表与详情重新读取；事件由页面在保存成功后派发。 */
function useRepositoryInvalidation() {
  const client = useQueryClient()
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ['repositories'] })
      void client.invalidateQueries({ queryKey: ['repository'] })
    }
    window.addEventListener(PROJECTS_CHANGED, refresh)
    return () => window.removeEventListener(PROJECTS_CHANGED, refresh)
  }, [client])
}

export interface RepositoryLoad {
  state: 'idle' | 'loading' | 'ready' | 'error'
  repository: RepositoryDetail | null
  error: string
  retry: () => void
}

export function useRepository(repositoryId: string, viewSyncId?: string): RepositoryLoad {
  useRepositoryInvalidation()
  const query = useQuery({
    queryKey: ['repository', repositoryId, viewSyncId ?? ''],
    enabled: repositoryId !== '',
    queryFn: async ({ signal }) => {
      const repository = parseRepositoryDetail(await apiRequest({ path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}${viewSyncId ? `?viewSyncId=${encodeURIComponent(viewSyncId)}` : ''}`, method: 'GET', signal }))
      if (repository.repositoryId !== repositoryId || (viewSyncId && (repository.viewSyncId !== viewSyncId || !repository.viewContext))) contractFailed('仓库分析来源不一致')
      return repository
    },
    refetchInterval: (q) => {
      const running = ['queued', 'collecting', 'registering', 'training', 'scoring'].includes(q.state.data?.latestSync?.status ?? '')
      return viewSyncId || !running ? 15000 : 1500
    },
  })
  return {
    state: repositoryId === '' ? 'idle' : query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    repository: query.data ?? null,
    error: query.error ? describe(query.error) : '',
    retry: () => { void query.refetch() },
  }
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
 * 按提交标识逐条取详情（仓库维度）。
 *
 * 详情可能来自深链接而不在当前分页里；逐条请求可以确认来源仍属于这次固定分析，
 * 取不到的单独列出，而不是悄悄回退到别的分析。
 */
export interface RepositoryCommitRecords {
  state: 'idle' | 'loading' | 'ready' | 'error'
  records: Map<string, Commit>
  failed: string[]
}

const EMPTY_COMMIT_RECORDS: RepositoryCommitRecords = { state: 'ready', records: new Map(), failed: [] }

export function useRepositoryCommitRecords(repositoryId: string, ids: string[], viewSyncId?: string): RepositoryCommitRecords {
  const [state, setState] = useState<RepositoryCommitRecords>({ state: 'idle', records: new Map(), failed: [] })
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
  if (repositoryId === '' || key === '') return EMPTY_COMMIT_RECORDS
  return state
}
