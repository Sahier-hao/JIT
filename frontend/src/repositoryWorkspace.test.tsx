import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useRepositories } from './repositoryWorkspace'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function view(repositoryId: string) {
  return {
    repositoryId,
    url: `https://github.com/octo/${repositoryId}.git`,
    displayName: repositoryId,
    defaultBranch: 'main',
    latestSyncId: null,
    latestSyncAt: null,
    viewSyncId: null,
    headCommit: null,
    commitCount: 1,
    distribution: { high: 0, medium: 0, low: 0, unknown: 0 },
    distributionRule: 'repo-distribution-v1',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  }
}

function page(repositories: unknown[], total: number, offset: number) {
  return new Response(JSON.stringify({ repositories, total, limit: 100, offset }))
}

afterEach(() => vi.restoreAllMocks())

it('跨页重复的项目按 id 去重，而不是整页失败', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(page([view(A), view(B)], 3, 0))
    .mockResolvedValueOnce(page([view(B), view(C)], 3, 2))
  const { result } = renderHook(() => useRepositories())
  await waitFor(() => expect(result.current.state).toBe('ready'))
  expect(result.current.items.map(item => item.repositoryId)).toEqual([A, B, C])
  expect(result.current.total).toBe(3)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(String(fetch.mock.calls[1][0])).toContain('offset=2')
})

it('拿不到全部项目时才报分页不一致', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(page([view(A)], 2, 0))
    .mockResolvedValueOnce(page([], 2, 1))
  const { result } = renderHook(() => useRepositories())
  await waitFor(() => expect(result.current.state).toBe('error'))
  expect(result.current.error).toContain('项目分页不一致')
  expect(result.current.items).toEqual([])
})
