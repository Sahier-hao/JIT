import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { RepositorySourcesPage } from './RepositorySourcesPage'
const ID = '11111111-1111-4111-8111-111111111111'
const JOB = { syncId: ID, repositoryId: ID, repositoryUrl: 'https://github.com/example/repo', branch: 'main', since: null, until: null, commitLimit: 500, requestedStrategy: 'auto', status: 'completed', stage: 'completed', datasetVersion: 'data-1', runId: null, modelId: null, modelStrategy: 'generic-model', degradeReason: 'fewRecords', trainRecords: 0, trainPositives: 0, createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:01:00Z', requestId: null, error: null }
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }) }
afterEach(() => vi.restoreAllMocks())
it('reads analysis jobs without a connection step', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ syncs: [], total: 0, limit: 20, offset: 0 }))
  render(<RepositorySourcesPage onOpenSync={vi.fn()}/>)
  expect(await screen.findByText(/还没有分析任务/)).toBeVisible()
  expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled()
})
it('submits one real job and retains the address', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => options?.method === 'POST' ? response({ ...JOB, status: 'queued', stage: 'queued' }, 202) : response({ syncs: [], total: 0, limit: 20, offset: 0 }))
  render(<RepositorySourcesPage onOpenSync={vi.fn()}/>); const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '仓库地址' }), JOB.repositoryUrl)
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1))
  const write = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(write[1]?.body))).toEqual({ repositoryUrl: JOB.repositoryUrl, commitLimit: 500, strategy: 'auto' })
  expect(screen.getByRole('textbox', { name: '仓库地址' })).toHaveValue(JOB.repositoryUrl)
})
it('opens the exact successful analysis and keeps its identity collapsed by default', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ syncs: [JOB], total: 1, limit: 20, offset: 0 }))
  const open = vi.fn(); render(<RepositorySourcesPage onOpenSync={open}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '查看结果' }))
  expect(open).toHaveBeenCalledWith(ID, ID)
  expect(screen.getByText(ID)).not.toBeVisible()
})
it('retains input and exposes a field failure with its request ID', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => options?.method === 'POST' ? response({ error: { code: 'INPUT_INVALID', message: '仓库地址无效', requestId: 'request-7', details: [{ field: 'repositoryUrl', reason: '无效' }] } }, 422) : response({ syncs: [], total: 0, limit: 20, offset: 0 }))
  render(<RepositorySourcesPage onOpenSync={vi.fn()}/>); const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '仓库地址' }), 'invalid')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  expect(await screen.findByText('仓库地址无效')).toBeVisible()
  expect(screen.getByRole('textbox', { name: '仓库地址' })).toHaveValue('invalid')
  expect(screen.getByText('request-7')).toBeVisible()
})

it('shows a failed terminal status instead of the last active stage', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ syncs: [{ ...JOB, status: 'failed', stage: 'collecting', error: { code: 'REPOSITORY_UNAVAILABLE', message: '仓库不可用' } }], total: 1, limit: 20, offset: 0 }))
  render(<RepositorySourcesPage onOpenSync={vi.fn()}/>)
  expect(await screen.findByText('分析失败')).toBeVisible()
  expect(screen.queryByText('正在采集')).not.toBeInTheDocument()
})
