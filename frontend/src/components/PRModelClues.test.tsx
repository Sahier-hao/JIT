import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PRModelClues } from './PRModelClues'
import { snapshot } from '../prReview.fixture'
import { modelChoices, NOW, PROJECT, response } from '../projectActivity.fixture'
const SYNC = '22222222-2222-4222-8222-222222222222'
function job(overrides: Record<string, unknown> = {}) { return { syncId: SYNC, repositoryId: PROJECT, repositoryUrl: 'https://github.com/example/project', branch: 'main', since: null, until: null, commitLimit: 500, requestedStrategy: 'generic-model', status: 'completed', stage: 'completed', datasetVersion: 'data-1', runId: null, modelId: 'model-original', requestedModelId: 'model-original', modelStrategy: 'generic-model', degradeReason: null, trainRecords: null, trainPositives: null, createdAt: NOW, updatedAt: NOW, requestId: null, error: null, sourceKind: 'pr', sourceSnapshotId: 'v1', origin: 'automatic', ...overrides } }
afterEach(() => vi.restoreAllMocks())
it('keeps legacy HEAD scores readable while disclosing their binding limits', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'legacy-head-v1', bindingLimitations: ['未登记独占 base ref'], scores: [{ commitId: 'a'.repeat(40), risk: .7 }] }] }))
  const navigate = vi.fn(), user = userEvent.setup()
  render(<PRModelClues source={snapshot()} navigate={navigate} onModelId={vi.fn()}/> )
  await user.click(await screen.findByText('风险概览'))
  await screen.findByText('旧版 HEAD 绑定分析')
  expect(screen.getByText('旧版 HEAD 绑定分析')).toBeVisible()
  expect(screen.getByText(/不能据此认定具有新版任务的独占基准版本/)).toBeVisible()
  expect(screen.getByText('未登记独占 base ref')).toBeVisible()
  expect(screen.getByText(/0.7000/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '打开固定分析' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'analysis', repositoryId: PROJECT, viewSyncId: SYNC, view: 'commits' })
})
it('does not add legacy warnings to new snapshot-model bindings', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'snapshot-model-v1', bindingLimitations: [], scores: [] }] }))
  render(<PRModelClues source={snapshot()} navigate={vi.fn()} onModelId={vi.fn()}/> )
  await screen.findByText(/项目自动分析 · 模型/)
  expect(screen.queryByText('旧版 HEAD 绑定分析')).not.toBeInTheDocument()
})
it('shows automatic and manual results side by side without overriding the round model', async () => {
  const onModelId = vi.fn(), user = userEvent.setup()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, scores: [] }, { sync: job({ syncId: '33333333-3333-4333-8333-333333333333', modelId: 'model-new', origin: 'manual' }), contextValid: true, scores: [] }] }))
  render(<PRModelClues source={snapshot()} navigate={vi.fn()} modelId="model-new" onModelId={onModelId}/>)
  await user.click(await screen.findByText('风险概览'))
  await screen.findByText(/项目自动分析 · 模型 model-original/)
  expect(screen.getByText(/手动分析 · 模型 model-new/)).toBeVisible()
  expect(screen.getByLabelText('本版本分析模型')).toHaveValue('model-new')
  expect(onModelId).not.toHaveBeenCalled()
})
it('retries the original fixed model with explicit retry and keeps cancellation actionable', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job({ status: 'cancelled', stage: 'collecting', modelId: null }), contextValid: false, scores: [] }] }))
  render(<PRModelClues source={snapshot()} navigate={vi.fn()} modelId="model-new" onModelId={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '用原模型主动重试' }))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toEqual({ modelId: 'model-original', retry: true })
})
it('confirms cancellation and reports errors without hiding the original model task', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : String(path).endsWith('/cancel') ? response({ error: { code: 'SYNC_NOT_ACTIVE', message: '任务刚刚结束，请重新读取', requestId: 'r' } }, 409) : response({ snapshotId: 'v1', analyses: [{ sync: job({ status: 'queued', stage: 'queued' }), contextValid: false, scores: [] }] }))
  render(<PRModelClues source={snapshot()} navigate={vi.fn()} onModelId={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByText('风险概览'))
  await user.click(await screen.findByRole('button', { name: '取消本次模型分析' }))
  expect(fetch.mock.calls.some(([path]) => String(path).endsWith('/cancel'))).toBe(false)
  await user.click(screen.getByRole('button', { name: '确认取消模型分析' }))
  await waitFor(() => expect(screen.getByText('任务刚刚结束，请重新读取')).toBeVisible())
  expect(screen.getByRole('button', { name: '继续分析' })).toBeEnabled()
})
