import { render, screen, TEST_REVIEW_ACCOUNT } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PullRequestPreview } from '@/features/reviews/components/PullRequestPreview'
import { accountWorkKey } from '@/features/reviews/prReview'

import { snapshot } from '@/features/reviews/prReview.fixture'
import { modelChoices, PROJECT, response } from '@/features/projects/projectActivity.fixture'
const SYNC = '33333333-3333-4333-8333-333333333333'
const SHA_A = 'b'.repeat(40), SHA_B = 'e'.repeat(40)
function job() { return { syncId: SYNC, repositoryId: PROJECT, repositoryUrl: 'https://github.com/example/project', branch: 'main', since: null, until: null, commitLimit: 500, requestedStrategy: 'generic-model', status: 'completed', stage: 'completed', datasetVersion: 'data-1', runId: null, modelId: 'model-original', requestedModelId: 'model-original', modelStrategy: 'generic-model', degradeReason: null, trainRecords: null, trainPositives: null, createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z', requestId: null, error: null, sourceKind: 'pr', sourceSnapshotId: 'v1', origin: 'automatic' } }
const source = { ...snapshot(), repositoryId: PROJECT, totalCommits: 2, body: '## Human Note\n\n- sidebar follows order\n- tray follows order\n\nKeep `appOrder` unchanged.', commits: [{ sha: SHA_A, message: 'handle expiry' }, { sha: SHA_B, message: 'docs note' }] }
function analyses() {
  return { snapshotId: 'v1', analyses: [{ sync: job(), contextValid: true, bindingKind: 'snapshot-model-v1', bindingLimitations: [], scores: [
    { commitId: SHA_A, risk: 0.8, files: ['src/token.py'], addedLines: 1, deletedLines: 1, fileCount: 1,
      labelEvidence: [{ fixCommit: 'f'.repeat(40), path: 'src/token.py', fixTime: '2026-11-01T00:00:00Z',
        ruleVersion: 'szz-full-v1', diffAnchor: `diff-${'a'.repeat(32)}`, lineRanges: [[3, 4]], parentRanges: [[9, 10]] }] },
    { commitId: SHA_B, risk: 0.3, files: ['tests/token.py'], addedLines: 1, deletedLines: 0, fileCount: 1 },
  ], fileRisks: [{ path: 'src/token.py', risk: 0.8 }, { path: 'tests/token.py', risk: 0.3 }] }] }
}
function explanation(commitId: string, risk: number) {
  return { repositoryId: PROJECT, viewSyncId: SYNC, commitId, risk, modelId: 'model-original', runId: null, datasetVersion: 'data-1',
    explanationStatus: 'not-generated', explanation: [], explanationReason: null, explanationMethod: null, explanationSummary: null,
    baselineSource: null, baselineDatasetVersion: null, missingBaselineFeatures: [], featureSchemaVersion: null, generatedAt: null, limitations: [] }
}
function explanationMethods(commitId: string) {
  return { repositoryId: PROJECT, viewSyncId: SYNC, commitId, modelId: 'model-original', runId: null, datasetVersion: 'data-1',
    defaultMethod: 'occlusion-mean-v1', modelAvailable: true, reasonCode: null, modelSha256: null,
    methods: [{ method: 'occlusion-mean-v1', name: '遮挡均值基线', applicableModels: ['logistic-regression'], unit: 'probability',
      baseline: 'training-partition-mean', cost: 'x', deterministic: true, limitations: ['不是缺陷结论'] }],
    savedMethods: [] }
}
function explanationList(commitId: string) {
  return { repositoryId: PROJECT, viewSyncId: SYNC, commitId, modelId: 'model-original', runId: null, datasetVersion: 'data-1', explanations: [] }
}
afterEach(() => vi.restoreAllMocks())
it('searches commits and explains one commit without leaving the read-only detail', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/repository-models')) return response({ models: modelChoices })
    if (path.includes('/explanation-methods?')) {
      const commitId = path.includes(SHA_B) ? SHA_B : SHA_A
      return response(explanationMethods(commitId))
    }
    if (path.includes('/explanations?')) {
      const commitId = path.includes(SHA_B) ? SHA_B : SHA_A
      return response(explanationList(commitId))
    }
    if (path.includes('/explanation?')) {
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
  expect(await screen.findByRole('heading', { name: '后续修复证据' })).toBeVisible()
  expect(screen.getByText('修复 diff 行 9–10')).toBeVisible()
  expect(screen.getByRole('link', { name: 'f'.repeat(12) })).toHaveAttribute(
    'href', `https://github.com/example/project/commit/${'f'.repeat(40)}#diff-${'a'.repeat(32)}L9`,
  )
  await user.click(screen.getByRole('button', { name: '模型解释' }))
  expect(await screen.findByRole('dialog')).toBeVisible()
  expect(await screen.findByText(/尚未生成该方法的模型解释/)).toBeVisible()
  expect(fetch.mock.calls.some(([path]) => String(path).includes(`/commits/${SHA_A}/explanation-methods?viewSyncId=${SYNC}`))).toBe(true)

  await user.click(screen.getByRole('button', { name: '关闭' }))
  await user.click(screen.getByRole('button', { name: '提交列表' }))
  await user.click(screen.getByText('docs note'))
  expect(screen.queryByText(/尚未生成该方法的模型解释/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '模型解释' })).toBeVisible()

  await user.click(screen.getByText('作者说明'))
  expect(screen.getByRole('heading', { name: 'Human Note' })).toBeVisible()
  expect(screen.getByText('sidebar follows order')).toBeVisible()
  expect(screen.getByText('appOrder')).toBeVisible()
})

it('links a candidate outside the diff to fixed source and continues directly in its work sheet', async () => {
  let checked = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input)
    if (path.endsWith('/repository-models')) return response({ models: modelChoices })
    if (path.includes('/context?')) return response({ snapshotId: 'v1', path: 'src/token.py', side: 'head', ref: source.headSha,
      complete: true, absent: false, totalLines: 4, content: 'try:\n    run()\nexcept:\n    pass\n' })
    if (path.includes('/candidates')) {
      if (options?.method === 'POST') checked = true
      if (!checked) return response({ snapshotId: 'v1', coverage: null, candidates: [] })
      return response({
        snapshotId: 'v1',
        coverage: { analyzed: ['src/token.py'], skipped: [], analyzerVersion: 'python-ast-v1', side: 'head', selected: 1, totalFiles: 1 },
        candidates: [{ side: 'head', path: 'src/token.py', line: 3, ruleId: 'py-bare-except', ruleVersion: '1',
          message: '裸 except 会吞掉所有异常', evidence: 'except:',
          suggestion: { ruleId: 'py-bare-except', ruleVersion: '1', title: '指明需要捕获的异常类型', rationale: '吞掉异常',
            location: { path: 'src/token.py', line: 3, side: 'head' }, manualChecks: ['确认范围'], example: null } }],
      })
    }
    return response(analyses())
  })
  const navigate = vi.fn()
  render(<PullRequestPreview source={source} repositoryId={PROJECT} navigate={navigate} onStart={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByText('handle expiry'))
  await user.click(screen.getByRole('button', { name: '检查当前文件' }))
  await user.click(await screen.findByRole('button', { name: '定位目标第 3 行' }))
  const marked = await screen.findByRole('button', { name: '查看目标第 3 行的可疑项' })
  expect(marked.closest('[data-code-line="head:3"]')).not.toBeNull()
  expect(screen.getByText(/裸 except 会吞掉所有异常/)).toBeVisible()
  expect(screen.getByText('指明需要捕获的异常类型')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '加入问题草稿' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  const saved = JSON.parse(localStorage.getItem(accountWorkKey(TEST_REVIEW_ACCOUNT)) ?? '{}')
  expect(Object.values(saved)[0]).toMatchObject({ viewedSnapshotId: 'v1', rounds: { v1: {
    currentFile: 'src/token.py', location: { side: 'head', line: 3 }, questions: expect.arrayContaining([
      expect.objectContaining({ kind: 'suggestion', evidence: [expect.objectContaining({ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 3 })] }),
    ]),
  } } })
})
