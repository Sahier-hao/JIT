/**
 * 项目管理接口（change `add-project-management`）。
 *
 * 与「发起分析」分开：先登记项目（不发作业），再在项目页发起分析、查看与清理分析记录。
 * 契约立场与其它请求层一致：形状不符不猜测，删除只接受服务端的成功语义（204）。
 */
import { useCallback, useEffect, useState } from 'react'
import { apiRequest, apiRequestWithStatus, fetchRepositorySyncs } from './apiClient'
import { parseRepositorySyncPage, parseSyncPage, type RepositorySyncPage, type SyncView } from './repositoryContract'
import { parseRepositoryView, type RepositoryView } from './repositoryWorkspace'
import { projectsChanged } from './projectEvents'

export interface CreatedRepository {
  repository: RepositoryView
  /** 201 表示新建，false 表示同址已有项目（服务端幂等复用）。 */
  created: boolean
}

function projectPath(repositoryId: string): string {
  return `/api/v1/repositories/${encodeURIComponent(repositoryId)}`
}

/** 只登记项目：不产生分析记录，重复地址返回既有项目。 */
export function createRepository(url: string, signal?: AbortSignal): Promise<CreatedRepository> {
  return apiRequestWithStatus({
    path: '/api/v1/repositories',
    method: 'POST',
    body: { repositoryUrl: url.trim() },
    signal,
  }).then(({ body, status }) => { const repository = parseRepositoryView(body); projectsChanged(); return { repository, created: status === 201 } })
}

/** 只改显示名；地址、标识与历史分析不变。 */
export function renameRepository(
  repositoryId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<RepositoryView> {
  return apiRequest({
    path: projectPath(repositoryId),
    method: 'PATCH',
    body: { displayName: displayName.trim() },
    signal,
  }).then(body => { const repository = parseRepositoryView(body); projectsChanged(); return repository })
}

/** 硬删项目及其分析记录与提交；服务端在存在进行中分析时返回 409。 */
export function deleteRepository(repositoryId: string, signal?: AbortSignal): Promise<void> {
  return apiRequest({
    path: projectPath(repositoryId),
    method: 'DELETE',
    signal,
    expectEmpty: true,
  }).then(() => { projectsChanged() })
}

/** 把一条已完成的分析设为当前结果；只改视图指向，历史记录不变。 */
export function selectRepositoryView(
  repositoryId: string,
  syncId: string,
  signal?: AbortSignal,
): Promise<RepositoryView> {
  return apiRequest({
    path: projectPath(repositoryId),
    method: 'PATCH',
    body: { viewSyncId: syncId },
    signal,
  }).then(body => { const repository = parseRepositoryView(body); projectsChanged(); return repository })
}

/** 项目的分析记录分页（按创建时间倒序）。 */
export function fetchRepositorySyncsPage(
  repositoryId: string,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<RepositorySyncPage> {
  return apiRequest({
    path: `${projectPath(repositoryId)}/syncs?limit=${limit}&offset=${offset}`,
    method: 'GET',
    signal,
  }).then((body) => parseRepositorySyncPage(body, repositoryId))
}

/** 删除一条已结束的分析记录；服务端对进行中的记录返回 409。 */
export function deleteRepositorySync(syncId: string, signal?: AbortSignal): Promise<void> {
  return apiRequest({
    path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}`,
    method: 'DELETE',
    signal,
    expectEmpty: true,
  }).then(() => { projectsChanged() })
}

function describe(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : '读取失败，请稍后重试'
}

export interface RecentSyncsLoad {
  state: 'loading' | 'ready' | 'error'
  syncs: SyncView[]
  error: string
  retry: () => void
}

/**
 * 项目列表页的状态来源：项目的最近一次作业不在项目列表里，用最近的作业页按
 * `latestSyncId` 对齐。只读一页，足够覆盖当前项目数。
 */
export function useRecentSyncs(limit = 50): RecentSyncsLoad {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Omit<RecentSyncsLoad, 'retry'>>({
    state: 'loading',
    syncs: [],
    error: '',
  })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState((previous) => ({ ...previous, state: 'loading', error: '' }))
    fetchRepositorySyncs(limit, 0, controller.signal)
      .then(parseSyncPage)
      .then((page) => {
        if (active) setState({ state: 'ready', syncs: page.syncs, error: '' })
      })
      .catch((error: unknown) => {
        if (active) setState({ state: 'error', syncs: [], error: describe(error) })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [limit, attempt])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

export interface RepositorySyncsLoad {
  state: 'idle' | 'loading' | 'ready' | 'error'
  syncs: SyncView[]
  total: number
  error: string
  retry: () => void
}

/** 项目页的「分析记录」：加载一页记录，失败保留错误原因，重试只重发本页。 */
export function useRepositorySyncs(repositoryId: string, limit = 20, offset = 0): RepositorySyncsLoad {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const [state, setState] = useState<Omit<RepositorySyncsLoad, 'retry'>>({
    state: 'idle',
    syncs: [],
    total: 0,
    error: '',
  })
  useEffect(() => {
    if (repositoryId === '') return
    const controller = new AbortController()
    let active = true
    setState((previous) => ({ ...previous, state: 'loading', error: '' }))
    fetchRepositorySyncsPage(repositoryId, limit, offset, controller.signal)
      .then((page) => {
        if (active) setState({ state: 'ready', syncs: page.syncs, total: page.total, error: '' })
      })
      .catch((error: unknown) => {
        if (active) setState({ state: 'error', syncs: [], total: 0, error: describe(error) })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [repositoryId, limit, offset, attempt])
  const running = state.syncs.some(job => ['queued', 'collecting', 'registering', 'training', 'scoring'].includes(job.status))
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') setAttempt(value => value + 1) }, 1500)
    return () => clearInterval(timer)
  }, [running])
  return { ...state, retry }
}
