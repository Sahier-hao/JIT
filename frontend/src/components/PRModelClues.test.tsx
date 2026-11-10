import { render, screen } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PRModelClues } from './PRModelClues'
import { useSnapshotAnalyses } from '../useSnapshotAnalyses'
import { modelChoices, NOW, PROJECT, response } from '../projectActivity.fixture'
const SYNC = '22222222-2222-4222-8222-222222222222'
function job(overrides: Record<string, unknown> = {}) { return { syncId: SYNC, repositoryId: PROJECT, repositoryUrl: 'https://github.com/example/project', branch: 'main', since: null, until: null, commitLimit: 500, requestedStrategy: 'generic-model', status: 'completed', stage: 'completed', datasetVersion: 'data-1', runId: null, modelId: 'model-original', requestedModelId: 'model-original', modelStrategy: 'generic-model', degradeReason: null, trainRecords: null, trainPositives: null, createdAt: NOW, updatedAt: NOW, requestId: null, error: null, sourceKind: 'pr', sourceSnapshotId: 'v1', origin: 'automatic', ...overrides } }
/** 以查询 hook 渲染概览，保留对接口契约与轮询状态的覆盖。 */
function Clues({ snapshotId }: { snapshotId: string }) {
  return <PRModelClues analysis={useSnapshotAnalyses(snapshotId)}/>
}
afterEach(() => vi.restoreAllMocks())
it('keeps legacy HEAD scores readable while disclosing their binding limits', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'legacy-head-v1', bindingLimitations: ['未登记独占 base ref'], scores: [{ commitId: 'a'.repeat(40), risk: .7 }] }] }))
  const user = userEvent.setup()
  render(<Clues snapshotId="v1"/>)
  expect(await screen.findByText(/最高 0\.700/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '打开分析' })).not.toBeInTheDocument()
  await user.click(screen.getByText('旧版 HEAD 绑定'))
  expect(screen.getByText(/不能据此认定具有新版任务的独占基准版本/)).toBeVisible()
  expect(screen.getByText('未登记独占 base ref')).toBeVisible()
})
it('does not add legacy warnings to new snapshot-model bindings', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: modelChoices }) : response({ snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'snapshot-model-v1', bindingLimitations: [], scores: [] }] }))
  render(<Clues snapshotId="v1"/>)
  expect(await screen.findByText('尚无分数')).toBeVisible()
  expect(screen.queryByText('旧版 HEAD 绑定')).not.toBeInTheDocument()
})
