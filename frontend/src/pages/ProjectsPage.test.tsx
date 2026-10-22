import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectsPage } from './ProjectsPage'

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
function mockApi(options: { onPatch?: (body: unknown) => void; onDelete?: () => void } = {}) {
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

afterEach(() => vi.restoreAllMocks())

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
