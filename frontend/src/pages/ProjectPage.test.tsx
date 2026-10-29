import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectPage } from './ProjectPage'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const OTHER = '44444444-4444-4444-8444-444444444444'
const NOW = '2026-10-22T12:00:00Z'

function detail(name = 'demo-project', view = SYNC) {
  return {
    repositoryId: REPO,
    url: 'https://github.com/example/demo',
    displayName: name,
    defaultBranch: 'main',
    latestSyncId: SYNC,
    latestSyncAt: NOW,
    viewSyncId: view,
    headCommit: 'a'.repeat(40),
    commitCount: 12,
    distribution: { high: 3, medium: 5, low: 4, unknown: 0 },
    distributionRule: 'repo-distribution-v1',
    createdAt: NOW,
    updatedAt: NOW,
    modelStrategy: 'repository-trained',
    degradeReason: null,
    runId: '33333333-3333-4333-8333-333333333333',
    modelId: null,
    datasetVersion: 'data-1',
    limitations: [],
    latestSync: job(),
    viewContext: { repositoryId: REPO, syncId: view, branch: 'main', completedAt: NOW, headCommit: 'a'.repeat(40), datasetVersion: 'data-1', modelId: null, runId: '33333333-3333-4333-8333-333333333333', missingMetadata: [] },
  }
}
function job(overrides: Record<string, unknown> = {}) {
  return {
    syncId: SYNC,
    repositoryId: REPO,
    repositoryUrl: 'https://github.com/example/demo',
    branch: 'main',
    since: null,
    until: null,
    commitLimit: 500,
    requestedStrategy: 'auto',
    status: 'completed',
    stage: 'completed',
    datasetVersion: 'data-1',
    runId: '33333333-3333-4333-8333-333333333333',
    modelId: null,
    modelStrategy: 'repository-trained',
    degradeReason: null,
    trainRecords: 12,
    trainPositives: 4,
    createdAt: NOW,
    updatedAt: NOW,
    requestId: null,
    error: null,
    ...overrides,
  }
}
function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mockApi(options: { onDeleteRecord?: () => void; onPost?: (body: unknown) => void; onSelect?: (body: unknown) => void } = {}) {
  let name = 'demo-project'
  let view = SYNC
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [job(), job({ syncId: OTHER, createdAt: '2026-10-21T12:00:00Z' })], total: 2, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/repositories/${REPO}` && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as { displayName?: string; viewSyncId?: string }
      if (body.viewSyncId) {
        options.onSelect?.(body)
        view = body.viewSyncId
        return response(detail(name, view))
      }
      name = String(body.displayName)
      return response(detail(name, view))
    }
    if (url.pathname === `/api/v1/repositories/${REPO}`) return response(detail(name, view))
    if (url.pathname === '/api/v1/repository-syncs' && method === 'POST') {
      options.onPost?.(JSON.parse(String(init?.body)))
      return response(job(), 202)
    }
    if (url.pathname === `/api/v1/repository-syncs/${SYNC}` && method === 'DELETE') {
      options.onDeleteRecord?.()
      return response(null, 204)
    }
    return response(detail(name, view))
  })
}

it('opens a comparison of a historical success against the pinned current result without changing it', async () => {
  const fetch = mockApi(), navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/> )
  await userEvent.click(await screen.findByRole('button', { name: '与当前结果对比' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'comparison', repositoryId: REPO, baseSyncId: OTHER, targetSyncId: SYNC })
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
})

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

it('restores normalized dates without widening the cancelled analysis window', async () => {
  sessionStorage.clear()
  let posted: unknown = null
  const fetch = mockApi({ onPost: value => { posted = value } }); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'cancelled', stage: 'collecting', since: '2024-01-01T00:00:00+00:00', until: '2024-01-09T00:00:00+00:00' })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  const retry = await screen.findByRole('button', { name: '用这些参数重试' })
  await user.click(retry)
  expect(screen.getByLabelText('起始日期')).toHaveValue('2024-01-01')
  expect(screen.getByLabelText('结束日期')).toHaveValue('2024-01-08')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).toMatchObject({ since: '2024-01-01', until: '2024-01-08' }))
})

it('shows queue position and confirms cancellation while preserving the current result', async () => {
  let cancelled = false
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const queued = job({ syncId: OTHER, status: cancelled ? 'cancelled' : 'queued', stage: 'queued',
      queuePosition: cancelled ? null : 2, cancelRequestedAt: cancelled ? NOW : null })
    if (url.pathname === `/api/v1/repository-syncs/${OTHER}/cancel`) { cancelled = true; return response({ ...queued, status: 'cancelled', cancelRequestedAt: NOW }) }
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [queued, job()], total: 2, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  expect(await screen.findByText('排队第 2 位')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '取消分析' }))
  expect(cancelled).toBe(false)
  await user.click(screen.getByRole('button', { name: '确认取消分析' }))
  expect(await screen.findByText('已取消')).toBeVisible()
  expect(screen.getByRole('button', { name: '用这些参数重试' })).toBeVisible()
  expect(screen.getByRole('button', { name: '查看提交与审查计划' })).toBeVisible()
})

it('keeps a cancellation error actionable and prevents repeated submissions', async () => {
  let requests = 0
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/cancel')) { requests++; return response({ error: { code: 'SYNC_NOT_ACTIVE', message: '分析已结束，请刷新', requestId: 'fixture' } }, 409) }
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'scoring', stage: 'scoring' })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '取消分析' }))
  await user.click(screen.getByRole('button', { name: '确认取消分析' }))
  expect(await screen.findByText('分析已结束，请刷新')).toBeVisible()
  expect(requests).toBe(1)
})

it('shows pending cancellation and does not offer deletion before the worker exits', async () => {
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'collecting', stage: 'collecting', cancelRequestedAt: NOW })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  expect(await screen.findByText('正在取消')).toBeVisible()
  expect(screen.queryByRole('button', { name: '删除记录' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '取消分析' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除记录' })).not.toBeInTheDocument()
})

it('shows the current result and opens the pinned review', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  expect(await screen.findByRole('heading', { name: 'demo-project' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '当前分析结果' })).toBeVisible()
  expect(screen.getAllByText('data-1')[0]).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '查看提交与审查计划' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'analysis', repositoryId: REPO, viewSyncId: SYNC, view: 'commits' })
})

it('posts a new analysis with the chosen branch and the default strategy', async () => {
  let posted: unknown = null
  mockApi({ onPost: body => { posted = body } })
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '发起分析' }))
  expect(await screen.findByRole('group', { name: '分析选项' })).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: '分支' }), 'release')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).not.toBeNull())
  expect(posted).toEqual({ repositoryUrl: 'https://github.com/example/demo', branch: 'release', commitLimit: 500, strategy: 'auto' })
})

it('returns to the project list from the back link', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  await screen.findByRole('heading', { name: 'demo-project' })
  await userEvent.setup().click(screen.getByRole('button', { name: '全部项目' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repositories' })
})

it('switches the current result from an older completed record', async () => {
  let selected: unknown = null
  mockApi({ onSelect: body => { selected = body } })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(await screen.findByRole('radio', { name: /设为当前结果/ }))
  await waitFor(() => expect(selected).not.toBeNull())
  expect(selected).toEqual({ viewSyncId: OTHER })
  await waitFor(() => expect(screen.getAllByText('当前结果').length).toBeGreaterThan(0))
})

it('deletes an ended analysis record from the list', async () => {
  const deleted = vi.fn()
  mockApi({ onDeleteRecord: deleted })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click((await screen.findAllByRole('button', { name: '删除记录' }))[0])
  expect(deleted).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认删除记录' }))
  await waitFor(() => expect(deleted).toHaveBeenCalled())
})

it('keeps following a queued job until the result is available', async () => {
  let reads = 0
  let started = false
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/v1/repository-syncs' && init?.method === 'POST') { started = true; return response(job({ status: 'queued', stage: 'queued' }), 202) }
    if (url.pathname.endsWith('/syncs')) {
      const complete = started && ++reads > 1
      return response({ repositoryId: REPO, syncs: [job({ status: complete ? 'completed' : 'queued', stage: complete ? 'completed' : 'queued' })], total: 1, limit: 10, offset: 0 })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '发起分析' }))
  await user.click(await screen.findByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(screen.getByRole('radio', { name: /当前结果/ })).toBeVisible(), { timeout: 7000 })
})

it('lets users reach an older analysis beyond the first ten', async () => {
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/syncs')) {
      const offset = Number(url.searchParams.get('offset'))
      return response({ repositoryId: REPO, syncs: offset ? [job({ syncId: OTHER })] : Array.from({ length: 10 }, (_, i) => job({ syncId: `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111` })), total: 11, limit: 10, offset })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(await screen.findByRole('article', { name: `分析记录 ${OTHER}` })).toBeVisible()
})

it('restores the bound fallback model on retry even if the administrator default changed', async () => {
  sessionStorage.clear()
  let posted: unknown = null
  const fetch = mockApi({ onPost: value => { posted = value } }); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'failed', stage: 'training', requestedStrategy: 'auto', requestedModelId: null, resolvedModelId: 'old-model', modelStrategy: 'generic-model', error: { code: 'MODEL_DISABLED', message: '停用' } })], total: 1, limit: 10, offset: 0 })
    if (url.pathname.endsWith('/repository-models')) return response({ models: [
      { modelId: 'old-model', name: '原模型', method: 'lr', state: 'ready', repositoryPredictionSupported: true, enabled: true, isDefault: false },
      { modelId: 'new-default', name: '新默认', method: 'dt', state: 'ready', repositoryPredictionSupported: true, enabled: true, isDefault: true },
    ] })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>); const user = userEvent.setup()
  const retry = await screen.findByRole('button', { name: '用这些参数重试' })
  await user.click(retry)
  await waitFor(() => expect(screen.getByLabelText('分析模型')).toHaveValue('old-model'))
  await waitFor(() => expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).toMatchObject({ modelId: 'old-model', strategy: 'generic-model' }))
})


