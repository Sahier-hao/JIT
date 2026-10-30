import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectsPage } from './ProjectsPage'
import { createWork, saveWork } from '../prReview'
import { snapshot } from '../prReview.fixture'

const REPO = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-22T12:00:00Z'

function repository(name = 'demo-project') {
  return {
    repositoryId: REPO,
    url: 'https://github.com/example/demo',
    displayName: name,
    defaultBranch: 'main',
    latestSyncId: null,
    latestSyncAt: null,
    viewSyncId: null,
    headCommit: null,
    commitCount: 0,
    distribution: { high: 0, medium: 0, low: 0, unknown: 0 },
    distributionRule: 'repo-distribution-v1',
    createdAt: NOW,
    updatedAt: NOW,
  }
}
function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mockApi(options: { onPatch?: (body: unknown) => void; onDelete?: () => void; onCreate?: (body: unknown) => void } = {}) {
  let name = 'demo-project'
  let removed = false
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === '/api/v1/repositories' && method === 'GET') {
      return response({ repositories: removed ? [] : [repository(name)], total: removed ? 0 : 1, limit: 100, offset: 0 })
    }
    if (url.pathname === '/api/v1/repository-syncs' && method === 'GET') {
      return response({ syncs: [], total: 0, limit: 50, offset: 0 })
    }
    if (url.pathname === '/api/v1/repositories' && method === 'POST') {
      options.onCreate?.(JSON.parse(String(init?.body)))
      return response(repository('app'), 201)
    }
    if (url.pathname === `/api/v1/repositories/${REPO}` && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as { displayName: string }
      options.onPatch?.(body)
      name = body.displayName
      return response(repository(name))
    }
    if (url.pathname === `/api/v1/repositories/${REPO}` && method === 'DELETE') {
      options.onDelete?.()
      removed = true
      return response(null, 204)
    }
    return response({})
  })
}

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

it('renames a project from the management menu without leaving the list', async () => {
  let patched: unknown = null
  mockApi({ onPatch: body => { patched = body } })
  render(<ProjectsPage navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '管理项目 demo-project' }))
  await user.click(screen.getByRole('menuitem', { name: '重命名' }))
  const input = screen.getByRole('textbox', { name: '项目显示名' })
  await user.clear(input)
  await user.type(input, '审查样例')
  await user.click(screen.getByRole('button', { name: '保存名称' }))
  await waitFor(() => expect(patched).toEqual({ displayName: '审查样例' }))
  expect(await screen.findByRole('heading', { name: '审查样例' })).toBeVisible()
})

it('asks for confirmation before deleting a project', async () => {
  const deleted = vi.fn()
  mockApi({ onDelete: deleted })
  render(<ProjectsPage navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '管理项目 demo-project' }))
  await user.click(screen.getByRole('menuitem', { name: '删除项目' }))
  expect(screen.getByRole('alertdialog', { name: '确认删除项目' })).toBeVisible()
  expect(deleted).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(deleted).toHaveBeenCalled())
  expect(await screen.findByText('从一个仓库开始')).toBeVisible()
})

it('opens the project from the card body', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectsPage navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '打开项目 demo-project' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: REPO })
})

it('shows the cross-project personal works view without the project list', async () => {
  mockApi()
  const work = createWork(snapshot())
  work.rounds.v1.progress['src/token.py'].state = 'read'
  saveWork(work)
  render(<ProjectsPage navigate={vi.fn()} view="reviews"/>)
  expect(await screen.findByRole('heading', { name: '我的审查' })).toBeVisible()
  expect(await screen.findByRole('heading', { name: /继续审查/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '仓库或 PR 地址' })).not.toBeInTheDocument()
})

it('navigates between projects and personal works through the page tabs', async () => {
  mockApi()
  const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectsPage navigate={navigate}/>)
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '我的审查' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-reviews' })
  await user.click(screen.getByRole('button', { name: '项目' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repositories' })
})

it('explains the empty personal works view without an intake form', async () => {
  mockApi()
  render(<ProjectsPage navigate={vi.fn()} view="reviews"/>)
  expect(await screen.findByText('还没有审查工作')).toBeVisible()
  expect(screen.queryByRole('textbox', { name: '仓库或 PR 地址' })).not.toBeInTheDocument()
})

it('creates a project from a dialog and keeps the list in place', async () => {
  let posted: unknown = null
  mockApi({ onCreate: body => { posted = body } })
  const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectsPage navigate={navigate}/>)
  await user.click((await screen.findAllByRole('button', { name: '新建项目' }))[0])
  const input = await screen.findByRole('textbox', { name: '仓库地址' })
  await user.type(input, '  https://github.com/example/app  ')
  await user.click(screen.getByRole('button', { name: '建立项目' }))
  await waitFor(() => expect(posted).toEqual({ repositoryUrl: 'https://github.com/example/app', autoUpdate: false }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: REPO }, true)
})
