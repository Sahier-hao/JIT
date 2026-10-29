/**
 * 项目管理请求层（change `add-project-management`）。
 *
 * 只验证数据层契约：请求方法/路径/请求体、204 的成功语义、201 与 200 的区分，
 * 以及项目分析记录页对归属不一致的拒绝。页面接线由后续任务覆盖。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  createRepository,
  cancelRepositorySync,
  deleteRepository,
  deleteRepositorySync,
  fetchRepositorySyncsPage,
  renameRepository,
  selectRepositoryView,
  useRepositorySyncs,
} from './projectClient'

const REPO_ID = '0b6a8d64-3d7c-4b1f-9a2e-5c8d7e6f5a41'
const SYNC_ID = '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f'

const REPOSITORY = {
  repositoryId: REPO_ID,
  url: 'https://github.com/octo/example',
  displayName: 'example',
  defaultBranch: 'main',
  latestSyncId: null,
  latestSyncAt: null,
  viewSyncId: null,
  headCommit: null,
  commitCount: 0,
  distribution: { high: 0, medium: 0, low: 0, unknown: 0 },
  distributionRule: 'repo-distribution-v1',
  createdAt: '2026-10-22 10:00:00',
  updatedAt: '2026-10-22 10:00:00',
}

const SYNC = {
  syncId: SYNC_ID,
  repositoryId: REPO_ID,
  repositoryUrl: 'https://github.com/octo/example',
  branch: 'main',
  since: null,
  until: null,
  commitLimit: 500,
  requestedStrategy: 'auto',
  status: 'completed',
  stage: 'completed',
  datasetVersion: 'kamei14-git-v1-example-100_200',
  runId: null,
  modelId: null,
  modelStrategy: 'generic-model',
  degradeReason: null,
  trainRecords: 100,
  trainPositives: 4,
  createdAt: '2026-10-22T02:00:00Z',
  updatedAt: '2026-10-22T02:01:00Z',
  requestId: null,
  error: null,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

it('取消请求返回实际作业身份并拒绝错配响应', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...SYNC, status: 'cancelled' }))
  await expect(cancelRepositorySync(SYNC_ID)).resolves.toMatchObject({ syncId: SYNC_ID, status: 'cancelled' })
  expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repository-syncs/${SYNC_ID}/cancel`)
  expect(fetch.mock.calls[0][1]?.method).toBe('POST')
  fetch.mockResolvedValue(json({ ...SYNC, syncId: REPO_ID, status: 'cancelled' }))
  await expect(cancelRepositorySync(SYNC_ID)).rejects.toThrow()
})

describe('createRepository', () => {
  it('只登记项目并区分新建与复用', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(REPOSITORY, 201))
    await expect(createRepository('  https://github.com/octo/example  ')).resolves.toMatchObject({
      created: true,
      repository: { repositoryId: REPO_ID },
    })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/repositories')
    expect(fetch.mock.calls[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ repositoryUrl: 'https://github.com/octo/example', autoUpdate: false })

    fetch.mockResolvedValue(json(REPOSITORY, 200))
    await expect(createRepository('https://github.com/octo/example')).resolves.toMatchObject({ created: false })
  })
})

describe('renameRepository', () => {
  it('只提交显示名', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ...REPOSITORY, displayName: '订单服务' }))
    await expect(renameRepository(REPO_ID, '  订单服务 ')).resolves.toMatchObject({ displayName: '订单服务' })
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repositories/${REPO_ID}`)
    expect(fetch.mock.calls[0][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ displayName: '订单服务' })
  })
})

describe('deleteRepository', () => {
  it('接受 204 且不解析正文', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(deleteRepository(REPO_ID)).resolves.toBeUndefined()
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repositories/${REPO_ID}`)
    expect(fetch.mock.calls[0][1]?.method).toBe('DELETE')
  })
})

describe('fetchRepositorySyncsPage', () => {
  it('按项目查询记录并带上分页参数', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ repositoryId: REPO_ID, syncs: [SYNC], total: 1, limit: 20, offset: 40 }))
    await expect(fetchRepositorySyncsPage(REPO_ID, 20, 40)).resolves.toMatchObject({
      repositoryId: REPO_ID,
      total: 1,
      limit: 20,
      offset: 40,
      syncs: [{ syncId: SYNC_ID, status: 'completed' }],
    })
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repositories/${REPO_ID}/syncs?limit=20&offset=40`)
  })

  it('拒绝归属不一致的记录页', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ repositoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', syncs: [], total: 0, limit: 20, offset: 0 }),
    )
    await expect(fetchRepositorySyncsPage(REPO_ID)).rejects.toThrow('分析记录归属不一致')
  })
})

describe('deleteRepositorySync', () => {
  it('接受 204 且删除的是记录而不是项目', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    await expect(deleteRepositorySync(SYNC_ID)).resolves.toBeUndefined()
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repository-syncs/${SYNC_ID}`)
    expect(fetch.mock.calls[0][1]?.method).toBe('DELETE')
  })
})

describe('useRepositorySyncs', () => {
  it('加载记录页并暴露总数', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ repositoryId: REPO_ID, syncs: [SYNC], total: 7, limit: 20, offset: 0 }),
    )
    const { result } = renderHook(() => useRepositorySyncs(REPO_ID))
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.total).toBe(7)
    expect(result.current.syncs.map((item) => item.syncId)).toEqual([SYNC_ID])
  })

  it('归属不一致时不展示记录，只保留错误', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ repositoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', syncs: [SYNC], total: 1, limit: 20, offset: 0 }),
    )
    const { result } = renderHook(() => useRepositorySyncs(REPO_ID))
    await waitFor(() => expect(result.current.state).toBe('error'))
    expect(result.current.syncs).toEqual([])
    expect(result.current.error).toContain('分析记录归属不一致')
  })
})

describe('selectRepositoryView', () => {
  it('只提交 viewSyncId，并解析返回的项目视图', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ ...REPOSITORY, viewSyncId: SYNC_ID }))
    await expect(selectRepositoryView(REPO_ID, SYNC_ID)).resolves.toMatchObject({ viewSyncId: SYNC_ID })
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repositories/${REPO_ID}`)
    expect(fetch.mock.calls[0][1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ viewSyncId: SYNC_ID })
  })
})
