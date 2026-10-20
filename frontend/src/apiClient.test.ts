import { afterEach, expect, it, vi } from 'vitest'
import { apiRequest } from './api/client'
import { ApiError, CancelledError, ContractError, NetworkError } from './api/primitives'
afterEach(() => vi.restoreAllMocks())
it('never adds an authorization header', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  await apiRequest({ path: '/api/v1/repositories', method: 'GET' })
  expect(new Headers(fetch.mock.calls[0][1]?.headers).has('Authorization')).toBe(false)
})
it('writes JSON once, without an automatic retry', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INPUT_INVALID', message: '地址无效', requestId: 'request-1', details: [{ field: 'repositoryUrl', reason: '无效' }] } }), { status: 422 }))
  await expect(apiRequest({ path: '/api/v1/repository-syncs', method: 'POST', body: { repositoryUrl: 'invalid' } })).rejects.toMatchObject({ code: 'INPUT_INVALID', requestId: 'request-1' })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ repositoryUrl: 'invalid' })
})
it('preserves the request ID when the error body is unreadable', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('broken', { status: 503, headers: { 'X-Request-Id': 'request-2' } }))
  await expect(apiRequest({ path: '/api/v1/repositories', method: 'GET' })).rejects.toMatchObject({ code: 'HTTP_503', requestId: 'request-2' })
})
it('rejects an invalid successful body instead of inventing data', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('invalid json'))
  await expect(apiRequest({ path: '/api/v1/repositories', method: 'GET' })).rejects.toBeInstanceOf(ContractError)
})
it('distinguishes cancellation from network failure', async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
  await expect(apiRequest({ path: '/api/v1/repositories', method: 'GET' })).rejects.toBeInstanceOf(NetworkError)
  const controller = new AbortController(); controller.abort()
  await expect(apiRequest({ path: '/api/v1/repositories', method: 'GET', signal: controller.signal })).rejects.toBeInstanceOf(CancelledError)
})
it('retains a structured API error', async () => {
  const error = new ApiError({ status: 404, code: 'REPOSITORY_UNKNOWN', message: '仓库不存在', requestId: 'request-3' })
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)
  await expect(apiRequest({ path: '/api/v1/repositories/missing', method: 'GET' })).rejects.toBe(error)
})
