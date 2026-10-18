import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitPagePath, useCommitPage, useShortlistRecords } from './repositoryPage'
import { emptyQuery, type Query } from './domain'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./apiClient', () => ({ apiRequest: request }))

const SYNC = '11111111-1111-4111-8111-111111111111'
const FIRST = 'a'.repeat(40)
const SECOND = 'b'.repeat(40)
const COMMIT = {
  commitId: FIRST, epoch: 1728000000, risk: 0.5, addedLines: 10, deletedLines: 2, files: 3,
  label: 0, labelNote: '未观测到缺陷引入（简化 SZZ）', features: { ns: 1, nd: 1, nf: 2, entropy: 0.5, la: 10, ld: 2 },
}

function page(overrides: Record<string, unknown> = {}) {
  return { syncId: SYNC, status: 'completed', total: 1, limit: 50, offset: 0, commits: [COMMIT], ...overrides }
}

beforeEach(() => { request.mockReset() })

describe('CRR-05 仓库提交的服务端查询', () => {
  it('总带排序与分页，留空的筛选条件不发送', () => {
    expect(commitPagePath(SYNC, emptyQuery, 50, 50)).toBe(`/api/v1/repository-syncs/${SYNC}/commits?limit=50&offset=50&sort=risk`)
  })

  it('搜索与日期原样交给服务端，中文与空格可安全编码', () => {
    const query: Query = { search: '缺陷 提交', start: '2024-01-01', end: '2024-02-01', sort: 'time' }
    const params = new URLSearchParams(commitPagePath(SYNC, query, 0, 50).split('?')[1])
    expect(params.get('search')).toBe('缺陷 提交')
    expect(params.get('start')).toBe('2024-01-01')
    expect(params.get('end')).toBe('2024-02-01')
    expect(params.get('sort')).toBe('time')
    expect(params.get('limit')).toBe('50')
    expect(params.get('offset')).toBe('0')
  })

  it('按页返回提交与总数', async () => {
    request.mockResolvedValue(page({ total: 137 }))
    const { result } = renderHook(() => useCommitPage(SYNC, 'token', emptyQuery, 50))
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.total).toBe(137)
    expect(result.current.commits.map(commit => commit.commitId)).toEqual([FIRST])
    expect(request.mock.calls[0][0]).toMatchObject({ path: expect.stringContaining('offset=50'), method: 'GET', token: 'token' })
  })

  it('没有凭据时不发请求，交给上层提示', () => {
    const { result } = renderHook(() => useCommitPage(SYNC, '', emptyQuery, 0))
    expect(result.current.state).toBe('idle')
    expect(request).not.toHaveBeenCalled()
  })

  it('筛选变化重新请求，并把服务端原话作为错误显示', async () => {
    request.mockResolvedValue(page())
    const { result, rerender } = renderHook(({ query }) => useCommitPage(SYNC, 'token', query, 0), { initialProps: { query: emptyQuery } })
    await waitFor(() => expect(result.current.state).toBe('ready'))
    request.mockRejectedValue(new Error('同步作业不存在'))
    rerender({ query: { ...emptyQuery, search: 'abc' } })
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.error).toBe('同步作业不存在')
    expect(request.mock.calls[1][0].path).toContain('search=abc')
  })

  it('重新加载会再次请求', async () => {
    request.mockResolvedValue(page())
    const { result } = renderHook(() => useCommitPage(SYNC, 'token', emptyQuery, 0))
    await waitFor(() => expect(result.current.state).toBe('ready'))
    act(() => result.current.retry())
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  })
})

describe('CRR-08 清单逐条读取', () => {
  it('取到的按提交标识入表，取不到的单独列出而不是悄悄消失', async () => {
    request.mockImplementation((options: { path: string }) => options.path.endsWith(`/${FIRST}`)
      ? Promise.resolve(COMMIT)
      : Promise.reject(new Error('提交不存在')))
    const { result } = renderHook(() => useShortlistRecords(SYNC, 'token', [FIRST, SECOND]))
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect([...result.current.records.keys()]).toEqual([FIRST])
    expect(result.current.failed).toEqual([SECOND])
  })

  it('清单为空时不发请求', () => {
    const { result } = renderHook(() => useShortlistRecords(SYNC, 'token', []))
    expect(result.current).toMatchObject({ state: 'ready', failed: [] })
    expect(request).not.toHaveBeenCalled()
  })
})
