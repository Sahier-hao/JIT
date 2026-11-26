import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LineRiskPanel } from '@/features/reviews/components/LineRiskPanel'
import { ReviewCode } from '@/features/reviews/components/ReviewCode'
import { response } from '@/features/projects/projectActivity.fixture'
import type { PRFile, PRSnapshot } from '@/features/reviews/prReviewClient'
import type { PRCandidateChecks } from '@/features/reviews/usePRCandidateChecks'

const snapshot: PRSnapshot = {
  snapshotId: 'v1', repositoryId: 'repo', owner: 'example', name: 'project', number: 12,
  title: 'Line risk', author: 'author', url: 'https://github.com/example/project/pull/12',
  body: '', remoteState: 'open', updatedAt: '2026-11-26T00:00:00Z', capturedAt: '2026-11-26T01:00:00Z',
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), baseBranch: 'main', headBranch: 'feature',
  baseRepository: 'example/project', headRepository: 'example/project', filesComplete: true,
  totalFiles: 1, commitsComplete: true, totalCommits: 1,
  commits: [{ sha: 'b'.repeat(40), message: 'add line' }], files: [],
}
const file: PRFile = {
  path: 'src/app.ts', previousPath: null, blobSha: 'c'.repeat(40), status: 'modified',
  additions: 2, deletions: 0, patch: '@@ -1,2 +1,3 @@\n const x = 1\n+const y = 2\n+return y\n',
  patchComplete: true,
}

afterEach(() => vi.restoreAllMocks())

it('ranks only changed lines, shows contributions, and locates a line', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/context?')) return response({
      snapshotId: 'v1', path: file.path, side: 'head', ref: snapshot.headSha,
      content: 'const x = 1\nconst y = 2\nreturn y\n', complete: true, absent: false, totalLines: 3,
    })
    if (path.endsWith('/research/line-model/score')) return response({
      language: 'typescript', count: 3, skippedBlank: 0, intercept: -0.2,
      contributionUnit: 'logit', contributionCaveat: '行级特征贡献，不是缺陷原因。', caveats: [],
      lines: [
        { rank: 1, line: 3, text: 'return y', score: 0.8, logit: 1.2, contributions: [{ feature: 'return', value: 1, weight: 0.4, contribution: 0.4 }], contributionTotal: 0.5, otherContribution: 0.1 },
        { rank: 2, line: 2, text: 'const y = 2', score: 0.4, logit: 0.2, contributions: [], contributionTotal: 0, otherContribution: 0 },
        { rank: 3, line: 1, text: 'const x = 1', score: 0.1, logit: -0.1, contributions: [], contributionTotal: 0, otherContribution: 0 },
      ],
    })
    return response({})
  })
  const locate = vi.fn()
  render(<LineRiskPanel source={snapshot} file={file} onLocate={locate}/>)
  expect(await screen.findByText('行级排序（研究）')).toBeVisible()
  expect(screen.getByText(/研究排序，不是缺陷概率/)).toBeVisible()
  expect(screen.getByText('return y')).toBeVisible()
  expect(screen.queryByText('const x = 1')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '定位目标第 3 行' }))
  expect(locate).toHaveBeenCalledWith(3)
  await userEvent.click(screen.getByText('行级特征贡献'))
  await waitFor(() => expect(screen.getByText(/return 语句/)).toBeVisible())
})

it('is reachable from the PR code reading toolbar', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/line-evidence?')) return response({
      schema: 'line-review-evidence-v1', status: 'supported', reason: null,
      sourceKind: 'pr-snapshot', resourceId: 'v1', repositoryId: 'repo',
      commitId: snapshot.headSha, ref: snapshot.headSha, path: file.path, side: 'head',
      language: 'typescript', coverage: { patchComplete: true, status: 'supported', addedLines: 2, eligibleLines: 2, skippedBlank: 0 },
      explanationMethod: 'linear-logodds-line-v1', explanationUnit: 'logit',
      contributionCaveat: '行级特征贡献，不是缺陷原因。', artifactSha256: 'd'.repeat(64), intercept: 0,
      lines: [{
        rank: 1, path: file.path, side: 'head', line: 3, text: 'return y', score: .8, logit: 1,
        languageContribution: 0, contributions: [
          { feature: 'return', label: 'return 语句', value: 1, weight: 1, contribution: 1, direction: 'increases' },
        ], contributionTotal: 1, otherContribution: 0,
      }],
      caveats: [],
    })
    return response({})
  })
  const checks = {
    fileResult: () => ({ candidates: [], label: '', ruleSet: null }),
    error: () => undefined,
    run: vi.fn(),
    canCheck: true,
  } as unknown as PRCandidateChecks
  render(<ReviewCode source={snapshot} file={file} checks={checks} view="unified"
    onViewChange={vi.fn()} onAdd={vi.fn()}/>)
  await userEvent.click(screen.getByRole('button', { name: '行级证据' }))
  expect(await screen.findByRole('heading', { name: '行级研究证据' })).toBeVisible()
})
