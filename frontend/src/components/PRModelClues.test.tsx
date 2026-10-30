import { render, screen } from '../test-utils'
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
  render(<PRModelClues source={snapshot()} navigate={navigate}/> )
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
  render(<PRModelClues source={snapshot()} navigate={vi.fn()}/> )
  await screen.findByText(/项目自动分析 · 模型/)
  expect(screen.queryByText('旧版 HEAD 绑定分析')).not.toBeInTheDocument()
})
