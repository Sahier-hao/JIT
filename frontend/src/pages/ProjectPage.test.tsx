import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectPage } from './ProjectPage'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-10-22T12:00:00Z'

function detail(name = 'demo-project') {
  return {
    repositoryId: REPO,
    url: 'https://github.com/example/demo',
    displayName: name,
    defaultBranch: 'main',
    latestSyncId: SYNC,
    latestSyncAt: NOW,
    viewSyncId: SYNC,
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
    viewContext: { repositoryId: REPO, syncId: SYNC, branch: 'main', completedAt: NOW, headCommit: 'a'.repeat(40), datasetVersion: 'data-1', modelId: null, runId: '33333333-3333-4333-8333-333333333333', missingMetadata: [] },
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
function mockApi(options: { onDeleteRecord?: () => void; onPost?: (body: unknown) => void } = {}) {
  let name = 'demo-project'
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [job()], total: 1, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/repositories/${REPO}` && method === 'PATCH') {
      name = String((JSON.parse(String(init?.body)) as { displayName: string }).displayName)
      return response(detail(name))
    }
    if (url.pathname === `/api/v1/repositories/${REPO}`) return response(detail(name))
    if (url.pathname === '/api/v1/repository-syncs' && method === 'POST') {
      options.onPost?.(JSON.parse(String(init?.body)))
      return response(job(), 202)
    }
    if (url.pathname === `/api/v1/repository-syncs/${SYNC}` && method === 'DELETE') {
      options.onDeleteRecord?.()
      return response(null, 204)
    }
    return response(detail(name))
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
  await user.click(screen.getByText('分析选项'))
  await user.type(screen.getByRole('textbox', { name: '分支' }), 'release')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).not.toBeNull())
  expect(posted).toEqual({ repositoryUrl: 'https://github.com/example/demo', branch: 'release', commitLimit: 500, strategy: 'auto' })
})

it('renames the project without touching its address or history', async () => {
  mockApi()
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '重命名' }))
  const input = screen.getByRole('textbox', { name: '项目显示名' })
  await user.clear(input)
  await user.type(input, '审查样例')
  await user.click(screen.getByRole('button', { name: '保存名称' }))
  expect(await screen.findByRole('heading', { name: '审查样例' })).toBeVisible()
  expect(screen.getByText('https://github.com/example/demo')).toBeVisible()
})

it('deletes an ended analysis record from the list', async () => {
  const deleted = vi.fn()
  mockApi({ onDeleteRecord: deleted })
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(await screen.findByRole('button', { name: '删除记录' }))
  await waitFor(() => expect(deleted).toHaveBeenCalled())
})

it('asks for confirmation before deleting the project', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '删除项目' }))
  expect(screen.getByRole('alertdialog', { name: '确认删除项目' })).toBeVisible()
  expect(navigate).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'repositories' }, true))
})

