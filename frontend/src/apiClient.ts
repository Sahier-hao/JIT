import { ApiError, type ApiErrorDetail, CancelledError, CONTRACT_MESSAGE, ContractError, NetworkError, record, text } from './apiContract'
import { parseSync, parseSyncPage, parseSyncCommitPage, syncBody, type SyncCommitPage, type SyncPage, type SyncView, type SyncStrategy } from './repositoryContract'

export interface ApiRequest {
  path: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  /** 成功响应没有正文（例如 DELETE 的 204）：不要按 JSON 解析。 */
  expectEmpty?: boolean
}

function detailsOf(value: unknown): ApiErrorDetail[] {
  if (!Array.isArray(value)) return []
  const details: ApiErrorDetail[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.field === 'string' && typeof raw.reason === 'string') {
      const conflict = typeof raw.commitId === 'string' && Array.isArray(raw.sourceSyncIds) && raw.sourceSyncIds.every(v => typeof v === 'string') && Array.isArray(raw.conflictingFields) && raw.conflictingFields.every(v => typeof v === 'string')
        ? { commitId: raw.commitId, sourceSyncIds: raw.sourceSyncIds as string[], conflictingFields: raw.conflictingFields as string[] } : {}
      details.push({ field: raw.field, reason: raw.reason, ...conflict })
    }
  }
  return details
}

async function failure(response: Response): Promise<ApiError> {
  const fallbackId = response.headers.get('X-Request-Id') ?? ''
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  try {
    const envelope = record(record(payload).error)
    return new ApiError({
      status: response.status,
      code: text(envelope.code),
      message: text(envelope.message),
      requestId: typeof envelope.requestId === 'string' ? envelope.requestId : fallbackId,
      details: detailsOf(envelope.details),
    })
  } catch {
    return new ApiError({
      status: response.status,
      code: `HTTP_${response.status}`,
      message: '服务返回了无法识别的错误响应，请稍后重试',
      requestId: fallbackId,
    })
  }
}

async function send(request: ApiRequest): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let init: RequestInit = { method: request.method, headers, signal: request.signal ?? null }
  if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init = { ...init, body: JSON.stringify(request.body) }
  }
  let response: Response
  try {
    response = await fetch(request.path, init)
  } catch (error) {
    if (request.signal?.aborted) throw new CancelledError()
    if (error instanceof ApiError) throw error
    throw new NetworkError()
  }
  if (!response.ok) throw await failure(response)
  return response
}

async function bodyOf(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined
  try {
    return await response.json()
  } catch {
    // 成功状态但正文不可解析：创建预测时必须按「未能确认保存结果」处理，而不是猜一个结果。
    throw new ContractError(CONTRACT_MESSAGE)
  }
}

export async function apiRequest(request: ApiRequest): Promise<unknown> {
  const response = await send(request)
  if (request.expectEmpty) return undefined
  return bodyOf(response)
}

/** 需要区分 201（新建）与 200（复用）时使用；成功语义仍由调用方按契约判断。 */
export async function apiRequestWithStatus(request: ApiRequest): Promise<{ body: unknown; status: number }> {
  const response = await send(request)
  return { body: await bodyOf(response), status: response.status }
}

export interface SyncForm {
  modelId?: string
  repositoryUrl: string
  branch: string
  since: string
  until: string
  commitLimit: string
  strategy: SyncStrategy
}

export function createRepositorySync(
  form: SyncForm,
  signal?: AbortSignal,
): Promise<SyncView> {
  return apiRequest({ path: '/api/v1/repository-syncs', method: 'POST', signal, body: syncBody(form) })
    .then(parseSync)
}

export function fetchRepositorySyncs(
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<SyncPage> {
  return apiRequest({
    path: `/api/v1/repository-syncs?limit=${limit}&offset=${offset}`,
    method: 'GET',
    signal,
  }).then(parseSyncPage)
}

export function fetchRepositorySync(syncId: string, signal?: AbortSignal): Promise<SyncView> {
  return apiRequest({
    path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}`,
    method: 'GET',
    signal,
  }).then(parseSync)
}

/** 一页最多 200 条；工作台首屏只取一页，并在界面上如实给出"已显示/共多少"。 */
export function fetchRepositorySyncCommits(
  syncId: string,
  limit = 200,
  offset = 0,
  signal?: AbortSignal,
): Promise<SyncCommitPage> {
  return apiRequest({
    path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}/commits?limit=${limit}&offset=${offset}`,
    method: 'GET',
    signal,
  }).then(parseSyncCommitPage)
}
