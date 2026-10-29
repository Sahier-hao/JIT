import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { RepositoryUpdates } from './RepositoryUpdates'

const REPO = '11111111-1111-4111-8111-111111111111'
const state = { repositoryId: REPO, enabled: false, branch: 'HEAD', intervalSeconds: 300, status: 'idle', lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, remoteHead: null, resolvedBranch: null, errorCode: null }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
afterEach(() => vi.restoreAllMocks())

it('checks immediately and shows checking separately from no changes', async () => {
  const changed = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') return response({ ...state, status: 'checking' }, 202)
    return response(state)
  })
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={changed}/>)
  await userEvent.click(await screen.findByRole('button', { name: /分支提醒/ }))
  await userEvent.click(await screen.findByRole('button', { name: '立即检查' }))
  expect((await screen.findAllByText('正在检查远端提交…'))[0]).toBeVisible()
  expect(screen.queryByText('没有新提交')).not.toBeInTheDocument()
  expect(fetch.mock.calls.some(([path, options]) => String(path).endsWith(`/${REPO}/refresh`) && options?.method === 'POST')).toBe(true)
  expect(changed).toHaveBeenCalled()
})

it('saves the reminder setting on the server', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => {
    if (options?.method === 'PATCH') return response({ ...state, enabled: true, nextCheckAt: '2026-10-26T12:05:00Z' })
    return response(state)
  })
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  await userEvent.click(await screen.findByRole('button', { name: /分支提醒/ }))
  await userEvent.click(await screen.findByRole('switch', { name: '分支提醒' }))
  await waitFor(() => expect(screen.getByRole('switch', { name: '分支提醒' })).toHaveAttribute('data-state', 'checked'))
  const patch = fetch.mock.calls.find(([, options]) => options?.method === 'PATCH')
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: true })
  expect(screen.getByText(/每 5 分钟检查一次/)).toBeVisible()
})

it('shows a new commit and offers to analyze it explicitly', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...state, enabled: true, status: 'updated', remoteHead: 'a'.repeat(40), resolvedBranch: 'main' }))
  const analyze = vi.fn()
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()} onAnalyze={analyze}/>)
  await userEvent.click(await screen.findByRole('button', { name: /分支提醒/ }))
  expect(await screen.findByText('有新提交待分析')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '分析这次更新' }))
  expect(analyze).toHaveBeenCalledWith('main')
})

it('exposes failure and retry without claiming that the repository is current', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...state, status: 'error', errorCode: 'REPOSITORY_UNAVAILABLE', lastCheckedAt: '2026-10-25T12:00:00Z' }))
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  await userEvent.click(await screen.findByRole('button', { name: /分支提醒/ }))
  expect(await screen.findByText(/无法读取仓库/)).toBeVisible()
  expect(screen.getByRole('button', { name: '重试检查' })).toBeEnabled()
  expect(screen.queryByText('没有新提交')).not.toBeInTheDocument()
})

it('rejects a reminder response for another repository', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ...state, repositoryId: '22222222-2222-4222-8222-222222222222' }))
  render(<RepositoryUpdates repositoryId={REPO} onUpdated={vi.fn()}/>)
  await userEvent.click(await screen.findByRole('button', { name: /分支提醒/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('仓库提醒来源不一致')
  expect(screen.queryByRole('button', { name: '立即检查' })).not.toBeInTheDocument()
})
