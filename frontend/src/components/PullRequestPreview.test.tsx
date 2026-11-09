import { render, screen } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PullRequestPreview } from './PullRequestPreview'
import { snapshot } from '../prReview.fixture'
import { modelChoices, PROJECT, response } from '../projectActivity.fixture'
const SYNC = '33333333-3333-4333-8333-333333333333'
const SHA_A = 'b'.repeat(40), SHA_B = 'e'.repeat(40)
function job() { return { syncId: SYNC, repositoryId: PROJECT, repositoryUrl: 'https://github.com/example/project', branch: 'main', since: null, until: null, commitLimit: 500, requestedStrategy: 'generic-model', status: 'completed', stage: 'completed', datasetVersion: 'data-1', runId: null, modelId: 'model-original', requestedModelId: 'model-original', modelStrategy: 'generic-model', degradeReason: null, trainRecords: null, trainPositives: null, createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', requestId: null, error: null, sourceKind: 'pr', sourceSnapshotId: 'v1', origin: 'automatic' } }
const source = { ...snapshot(), repositoryId: PROJECT, totalCommits: 2, body: '## Human Note\n\n- sidebar follows order\n- tray follows order\n\nKeep `appOrder` unchanged.', commits: [{ sha: SHA_A, message: 'handle expiry' }, { sha: SHA_B, message: 'docs note' }] }
function analyses() {
  return { snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'snapshot-model-v1', bindingLimitations: [], scores: [
    { commitId: SHA_A, risk: 0.8, files: ['src/token.py'], addedLines: 1, deletedLines: 1, fileCount: 1 },
    { commitId: SHA_B, risk: 0.3, files: ['tests/token.py'], addedLines: 1, deletedLines: 0, fileCount: 1 },
  ], fileRisks: [{ path: 'src/token.py', risk: 0.8 }, { path: 'tests/token.py', risk: 0.3 }] }] }
}
function explanation(commitId: string, risk: number) {
  return { repositoryId: PROJECT, viewSyncId: SYNC, commitId, risk, modelId: 'model-original', runId: null, datasetVersion: 'data-1',
    explanationStatus: 'not-generated', explanation: [], explanationReason: null, explanationMethod: null, explanationSummary: null,
    baselineSource: null, baselineDatasetVersion: null, missingBaselineFeatures: [], featureSchemaVersion: null, generatedAt: null, limitations: [] }
}
afterEach(() => vi.restoreAllMocks())
it('searches commits and explains one commit without leaving the read-only detail', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/repository-models')) return response({ models: modelChoices })
    if (path.includes('/explanation')) {
      const commitId = path.includes(SHA_B) ? SHA_B : SHA_A
      return response(explanation(commitId, commitId === SHA_B ? 0.3 : 0.8))
    }
    return response(analyses())
  })
  render(<PullRequestPreview source={source} repositoryId={PROJECT} navigate={vi.fn()} onStart={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByText(/最高 0\.800/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '打开分析' })).not.toBeInTheDocument()

  await user.type(screen.getByLabelText('搜索 PR 提交'), 'docs')
  expect(screen.queryByText('handle expiry')).not.toBeInTheDocument()
  expect(screen.getByText('docs note')).toBeVisible()
  await user.clear(screen.getByLabelText('搜索 PR 提交'))
  await user.type(screen.getByLabelText('搜索 PR 提交'), 'no-such-commit')
  expect(screen.getByText(/没有匹配的提交/)).toBeVisible()
  await user.clear(screen.getByLabelText('搜索 PR 提交'))

  await user.click(screen.getByText('handle expiry'))
  await user.click(screen.getByRole('button', { name: '模型解释' }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(await screen.findByText(/尚未生成该提交的模型解释/)).toBeVisible()
  expect(fetch.mock.calls.some(([path]) => String(path).includes(`/commits/${SHA_A}/explanation?viewSyncId=${SYNC}`))).toBe(true)

  await user.click(screen.getByRole('button', { name: '提交列表' }))
  await user.click(screen.getByText('docs note'))
  expect(screen.queryByText(/尚未生成该提交的模型解释/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '模型解释' })).toBeVisible()

  await user.click(screen.getByText('作者说明'))
  expect(screen.getByRole('heading', { name: 'Human Note' })).toBeVisible()
  expect(screen.getByText('sidebar follows order')).toBeVisible()
  expect(screen.getByText('appOrder')).toBeVisible()
})
