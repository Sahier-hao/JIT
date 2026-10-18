/**
 * 六个既有 `/api/v1` 接口的请求层。
 *
 * 职责边界：
 * - 只有这里给受保护请求附加 `Authorization`；旧历史回放请求（`/api/review-batch`）不经过本模块，
 *   因此不会因为输入了团队凭据而带上它。
 * - 两个写请求（登记、创建预测）绝不自动重发：调用方必须由用户再次显式触发。
 * - 成功正文一律交给契约解析器判定，本模块不猜测形状。
 */

import {
  ApiError,
  type ApiErrorDetail,
  CancelledError,
  CONTRACT_MESSAGE,
  ContractError,
  NetworkError,
  record,
  text,
} from './apiContract'
import {
  type FeatureSchema,
  type ModelCandidate,
  type ModelEntry,
  parseCandidateList,
  parseFeatureSchema,
  parseModelList,
  parseRegistration,
  type RegistrationOutcome,
} from './catalogContract'
import {
  type PredictionResult,
  type Submission,
  parseBatchPrediction,
  parseCreatedPrediction,
  SIX_FIELD_SCHEMA,
} from './predictionContract'
import {
  type SyncCommitPage,
  type SyncPage,
  type SyncView,
  parseSync,
  parseSyncCommitPage,
  parseSyncPage,
  syncBody,
  type SyncStrategy,
} from './repositoryContract'

export interface ApiRequest {
  path: string
  method: 'GET' | 'POST'
  token: string
  body?: unknown
  signal?: AbortSignal
}

function detailsOf(value: unknown): ApiErrorDetail[] {
  if (!Array.isArray(value)) return []
  const details: ApiErrorDetail[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const raw = item as Record<string, unknown>
    if (typeof raw.field === 'string' && typeof raw.reason === 'string') {
      details.push({ field: raw.field, reason: raw.reason })
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

export async function apiRequest(request: ApiRequest): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (request.token !== '') headers.Authorization = `Bearer ${request.token}`
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
  try {
    return await response.json()
  } catch {
    // 成功状态但正文不可解析：创建预测时必须按「未能确认保存结果」处理，而不是猜一个结果。
    throw new ContractError(CONTRACT_MESSAGE)
  }
}

export function fetchModels(token: string, signal?: AbortSignal): Promise<ModelEntry[]> {
  return apiRequest({ path: '/api/v1/models', method: 'GET', token, signal }).then(parseModelList)
}

export function fetchCandidates(token: string, signal?: AbortSignal): Promise<ModelCandidate[]> {
  return apiRequest({ path: '/api/v1/model-candidates', method: 'GET', token, signal }).then(parseCandidateList)
}

export function registerModel(
  token: string,
  candidate: { candidateId: string; expectedManifestSha256: string },
  signal?: AbortSignal,
): Promise<RegistrationOutcome> {
  return apiRequest({
    path: '/api/v1/models/register',
    method: 'POST',
    token,
    signal,
    body: { candidateId: candidate.candidateId, expectedManifestSha256: candidate.expectedManifestSha256 },
  }).then(parseRegistration)
}

export function fetchFeatureSchema(
  token: string,
  version: string,
  signal?: AbortSignal,
): Promise<FeatureSchema> {
  return apiRequest({
    path: `/api/v1/feature-schemas/${encodeURIComponent(version)}`,
    method: 'GET',
    token,
    signal,
  }).then(parseFeatureSchema)
}

/** 只提交模型身份、六字段与记录元数据；不提交任何服务端可从别处取得的路径或凭据。 */
export function predictionBody(submission: Submission): Record<string, unknown> {
  const record_: Record<string, unknown> = {
    recordId: submission.recordId.trim(),
    features: { ...submission.features },
  }
  if (submission.commitId !== null) record_.commitId = submission.commitId
  if (submission.time !== null) record_.time = submission.time
  return {
    modelId: submission.modelId,
    featureSchemaVersion: SIX_FIELD_SCHEMA,
    project: submission.project.trim(),
    record: record_,
  }
}

export function createPrediction(
  token: string,
  submission: Submission,
  signal?: AbortSignal,
): Promise<PredictionResult> {
  return apiRequest({
    path: '/api/v1/predictions',
    method: 'POST',
    token,
    signal,
    body: predictionBody(submission),
  }).then((payload) => parseCreatedPrediction(payload, submission))
}

export function fetchPredictionBatch(
  token: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<PredictionResult> {
  return apiRequest({
    path: `/api/v1/prediction-batches/${encodeURIComponent(batchId)}`,
    method: 'GET',
    token,
    signal,
  }).then((payload) => parseBatchPrediction(payload, batchId))
}

export interface SyncForm {
  repositoryUrl: string
  branch: string
  since: string
  until: string
  commitLimit: string
  strategy: SyncStrategy
}

export function createRepositorySync(
  token: string,
  form: SyncForm,
  signal?: AbortSignal,
): Promise<SyncView> {
  return apiRequest({ path: '/api/v1/repository-syncs', method: 'POST', token, signal, body: syncBody(form) })
    .then(parseSync)
}

export function fetchRepositorySyncs(
  token: string,
  limit = 20,
  offset = 0,
  signal?: AbortSignal,
): Promise<SyncPage> {
  return apiRequest({
    path: `/api/v1/repository-syncs?limit=${limit}&offset=${offset}`,
    method: 'GET',
    token,
    signal,
  }).then(parseSyncPage)
}

export function fetchRepositorySync(token: string, syncId: string, signal?: AbortSignal): Promise<SyncView> {
  return apiRequest({
    path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}`,
    method: 'GET',
    token,
    signal,
  }).then(parseSync)
}

/** 一页最多 200 条；工作台首屏只取一页，并在界面上如实给出"已显示/共多少"。 */
export function fetchRepositorySyncCommits(
  token: string,
  syncId: string,
  limit = 200,
  offset = 0,
  signal?: AbortSignal,
): Promise<SyncCommitPage> {
  return apiRequest({
    path: `/api/v1/repository-syncs/${encodeURIComponent(syncId)}/commits?limit=${limit}&offset=${offset}`,
    method: 'GET',
    token,
    signal,
  }).then(parseSyncCommitPage)
}
