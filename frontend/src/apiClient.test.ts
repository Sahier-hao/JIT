/**
 * 六个既有接口的请求层（任务 2.2、MPW-02、MPW-07）。
 *
 * 重点验证三件事：凭据只出现在受保护请求的 Authorization 头里、请求体恰好是约定字段、
 * 两个写请求在任何失败下都不会自动重发。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, CancelledError, ContractError, NetworkError } from './apiContract'
import {
  apiRequest,
  createPrediction,
  fetchCandidates,
  fetchFeatureSchema,
  fetchModels,
  fetchPredictionBatch,
  predictionBody,
  registerModel,
} from './apiClient'
import type { Submission } from './predictionContract'
import {
  BATCH_ID,
  CANDIDATE_ID,
  MANIFEST_SHA,
  MODEL_ID,
  SIX_VALUES,
  candidatePayload,
  errorResponse,
  jsonResponse,
  modelPayload,
  predictionPayload,
  schemaPayload,
} from './testFixtures'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 每个用例只关心「最近一次真正发出的请求」，便于同一个用例里连续调用多个接口。 */
function firstCall() {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>
}

describe('apiRequest', () => {
  it('有凭据时附加 Bearer 头，没有凭据时不带 Authorization', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { models: [] }))
    await apiRequest({ path: '/api/v1/models', method: 'GET', token: 'memory-token' })
    expect(headersOf(firstCall()[1]).Authorization).toBe('Bearer memory-token')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { models: [] }))
    await apiRequest({ path: '/api/v1/models', method: 'GET', token: '' })
    expect(headersOf(firstCall()[1]).Authorization).toBeUndefined()
  })

  it('GET 不带请求体，POST 带 JSON 请求体', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await apiRequest({ path: '/api/v1/models', method: 'GET', token: 't' })
    expect(firstCall()[1].body).toBeUndefined()

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}))
    await apiRequest({ path: '/api/v1/models/register', method: 'POST', token: 't', body: { a: 1 } })
    expect(firstCall()[1].body).toBe('{"a":1}')
    expect(headersOf(firstCall()[1])['Content-Type']).toBe('application/json')
  })

  it('错误正文按规范解析出 code、message、requestId 与字段明细', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(422, 'INPUT_INVALID', '请求格式或字段值无效', {
        requestId: 'req-422',
        details: [{ field: 'record.features.ns', reason: '请求格式或字段值无效' }],
      }),
    )
    const error = await apiRequest({ path: '/api/v1/predictions', method: 'POST', token: 't', body: {} }).catch(
      (thrown: unknown) => thrown,
    )
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(422)
    expect(apiError.code).toBe('INPUT_INVALID')
    expect(apiError.message).toBe('请求格式或字段值无效')
    expect(apiError.requestId).toBe('req-422')
    expect(apiError.details).toEqual([{ field: 'record.features.ns', reason: '请求格式或字段值无效' }])
  })

  it('错误正文不可解析时退回响应头里的请求编号与状态码', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, null, { 'X-Request-Id': 'req-header' }))
    const error = (await apiRequest({ path: '/api/v1/models', method: 'GET', token: 't' }).catch(
      (thrown: unknown) => thrown,
    )) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('HTTP_503')
    expect(error.requestId).toBe('req-header')
    expect(error.details).toEqual([])
  })

  it('成功状态但正文不可解析时给出契约错误，而不是猜一个结果', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, null))
    await expect(apiRequest({ path: '/api/v1/predictions', method: 'POST', token: 't', body: {} })).rejects.toBeInstanceOf(
      ContractError,
    )
  })

  it('网络失败与主动取消分别归类', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(apiRequest({ path: '/api/v1/models', method: 'GET', token: 't' })).rejects.toBeInstanceOf(NetworkError)

    const controller = new AbortController()
    controller.abort()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(
      apiRequest({ path: '/api/v1/models', method: 'GET', token: 't', signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancelledError)
  })
})

describe('六个接口的路径与请求体', () => {
  it('模型、候选与 schema 走既有路径', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { models: [modelPayload()] }))
    await fetchModels('t')
    expect(firstCall()[0]).toBe('/api/v1/models')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { candidates: [candidatePayload()] }))
    await fetchCandidates('t')
    expect(firstCall()[0]).toBe('/api/v1/model-candidates')

    fetchMock.mockResolvedValueOnce(jsonResponse(200, schemaPayload()))
    await fetchFeatureSchema('t', 'openstack-six-v1')
    expect(firstCall()[0]).toBe('/api/v1/feature-schemas/openstack-six-v1')
  })

  it('登记请求体恰为候选身份与期望清单哈希，不接受路径或上传', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { created: true, model: modelPayload() }))
    const outcome = await registerModel('admin-token', {
      candidateId: CANDIDATE_ID,
      expectedManifestSha256: MANIFEST_SHA,
    })
    expect(outcome.created).toBe(true)
    expect(firstCall()[0]).toBe('/api/v1/models/register')
    expect(JSON.parse(String(firstCall()[1].body))).toEqual({
      candidateId: CANDIDATE_ID,
      expectedManifestSha256: MANIFEST_SHA,
    })
  })

  it('预测请求体恰为模型身份、六字段与记录元数据', () => {
    const submission: Submission = {
      modelId: MODEL_ID,
      project: ' openstack ',
      recordId: ' demo-0001 ',
      features: { ...SIX_VALUES },
      commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      time: '2026-10-15T18:00:00Z',
    }
    expect(predictionBody(submission)).toEqual({
      modelId: MODEL_ID,
      featureSchemaVersion: 'openstack-six-v1',
      project: 'openstack',
      record: {
        recordId: 'demo-0001',
        features: SIX_VALUES,
        commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        time: '2026-10-15T18:00:00Z',
      },
    })
    const minimal = predictionBody({ ...submission, commitId: null, time: null })
    expect(Object.keys(minimal)).toEqual(['modelId', 'featureSchemaVersion', 'project', 'record'])
    expect(Object.keys(minimal.record as object)).toEqual(['recordId', 'features'])
  })

  it('创建预测解析成功正文，重开按地址批次核对', async () => {
    const submission: Submission = {
      modelId: MODEL_ID,
      project: 'openstack',
      recordId: 'demo-0001',
      features: { ...SIX_VALUES },
      commitId: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      time: '2026-10-15T18:00:00Z',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(201, predictionPayload()))
    const created = await createPrediction('t', submission)
    expect(firstCall()[0]).toBe('/api/v1/predictions')
    expect(created.batchId).toBe(BATCH_ID)

    fetchMock.mockResolvedValueOnce(jsonResponse(200, predictionPayload()))
    await fetchPredictionBatch('t', BATCH_ID)
    expect(firstCall()[0]).toBe(`/api/v1/prediction-batches/${BATCH_ID}`)
  })
})

describe('写请求不自动重发（MPW-07）', () => {
  it('创建预测失败后只发出一次请求', async () => {
    fetchMock.mockResolvedValue(errorResponse(503, 'INFERENCE_ERROR', '所选模型推理失败，未保存预测'))
    const submission: Submission = {
      modelId: MODEL_ID,
      project: 'openstack',
      recordId: 'demo-0001',
      features: { ...SIX_VALUES },
      commitId: null,
      time: null,
    }
    await expect(createPrediction('t', submission)).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('登记失败后只发出一次请求', async () => {
    fetchMock.mockResolvedValue(errorResponse(409, 'CONTEXT_MISMATCH', '候选或运行上下文发生变化，请重新选择'))
    await expect(
      registerModel('t', { candidateId: CANDIDATE_ID, expectedManifestSha256: MANIFEST_SHA }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('网络中断时同样不重发', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      createPrediction('t', {
        modelId: MODEL_ID,
        project: 'openstack',
        recordId: 'demo-0001',
        features: { ...SIX_VALUES },
        commitId: null,
        time: null,
      }),
    ).rejects.toBeInstanceOf(NetworkError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
