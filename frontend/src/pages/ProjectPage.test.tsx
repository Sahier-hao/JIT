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

afterEach(() => vi.restoreAllMocks())

it('shows the current result and opens the pinned review', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  expect(await screen.findByRole('heading', { name: 'demo-project' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '当前分析结果' })).toBeVisible()
  expect(screen.getAllByText('data-1')[0]).toBeVisible()
  await userEvent.setup().click(screen.getAllByRole('button', { name: '打开审查' })[0])
  expect(navigate).toHaveBeenCalledWith({ name: 'analysis', repositoryId: REPO, viewSyncId: SYNC, view: 'commits' })
})

it('posts a new analysis with the chosen branch and the default strategy', async () => {
  let posted: unknown = null
  mockApi({ onPost: body => { posted = body } })
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  expect(screen.getByRole('button', { name: /分析选项/ })).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: /分析选项/ }))
  expect(screen.getByRole('group', { name: '分析选项' })).toBeVisible()
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
  await waitFor(() => expect(deleted).toHaveBeenCalled())
})


