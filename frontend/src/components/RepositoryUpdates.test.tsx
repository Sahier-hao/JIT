import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { RepositoryUpdates } from './RepositoryUpdates'

const REPO = '11111111-1111-4111-8111-111111111111'
const state = { repositoryId: REPO, enabled: false, branch: 'HEAD', modelId: 'model-one', intervalSeconds: 300, windowDays: 90, commitLimit: 500, status: 'idle', lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, remoteHead: null, resolvedBranch: null, syncId: null, errorCode: null }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
afterEach(() => vi.restoreAllMocks())

it('checks immediately and shows checking separately from no changes', async () => {
  const changed = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/repository-models')) return response({ models: [] })
    if (options?.method === 'POST') return response({ ...state, status: 'checking' }, 202)
    return response(state)
  })
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={changed}/>)
  await userEvent.click(await screen.findByRole('button', { name: '立即更新' }))
  expect(await screen.findByText('正在检查远端提交…')).toBeVisible()
  expect(screen.queryByText('没有新提交')).not.toBeInTheDocument()
  expect(fetch.mock.calls.some(([path, options]) => String(path).endsWith(`/${REPO}/refresh`) && options?.method === 'POST')).toBe(true)
  expect(changed).toHaveBeenCalled()
})

it('saves the automatic setting on the server and preserves model identity', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/repository-models')) return response({ models: [] })
    if (options?.method === 'PATCH') return response({ ...state, enabled: true, nextCheckAt: '2026-10-26T12:05:00Z' })
    return response(state)
  })
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  await userEvent.click(await screen.findByRole('checkbox', { name: '自动检查仓库更新' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '自动检查仓库更新' })).toBeChecked())
  const patch = fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: true })
  expect(screen.getByText(/服务运行期间/)).toBeVisible()
})

it('exposes failure and retry without claiming that the repository is current', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models')
    ? response({ models: [] }) : response({ ...state, status: 'error', errorCode: 'MODEL_DISABLED', lastCheckedAt: '2026-10-25T12:00:00Z' }))
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  expect(await screen.findByText(/更新模型已停用/)).toBeVisible()
  expect(screen.getByRole('button', { name: '重试更新' })).toBeEnabled()
  expect(screen.queryByText('没有新提交')).not.toBeInTheDocument()
})

it('rejects an update response for another repository', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models')
    ? response({ models: [] }) : response({ ...state, repositoryId: '22222222-2222-4222-8222-222222222222' }))
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  expect(await screen.findByRole('alert')).toHaveTextContent('仓库更新来源不一致')
  expect(screen.queryByRole('button', { name: '立即更新' })).not.toBeInTheDocument()
})
