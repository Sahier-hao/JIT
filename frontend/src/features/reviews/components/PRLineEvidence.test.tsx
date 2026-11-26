import { render, screen, waitFor } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
import { PRLineEvidence } from '@/features/reviews/components/PRLineEvidence'
import type { PRFile, PRSnapshot } from '@/features/reviews/prReviewClient'

const SOURCE: PRSnapshot = {
  number: 1, title: 'PR', author: 'author', url: 'https://github.com/example/project/pull/1',
  updatedAt: '2026-11-26T00:00:00Z', remoteState: 'open', snapshotId: 'v1', repositoryId: '11111111-1111-4111-8111-111111111111',
  owner: 'example', name: 'project', body: '', baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40),
  baseBranch: 'main', headBranch: 'feature', baseRepository: 'example/project', headRepository: 'example/project',
  capturedAt: '2026-11-26T00:00:00Z', files: [], totalFiles: 1, filesComplete: true,
  commits: [], totalCommits: 1, commitsComplete: true,
}
function file(path: string): PRFile {
  return { path, previousPath: null, blobSha: 'c'.repeat(40), status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b', patchComplete: true }
}
function result(path: string, line = 7) {
  return {
    schema: 'line-review-evidence-v1', status: 'supported', reason: null,
    sourceKind: 'pr-snapshot', resourceId: 'v1', repositoryId: SOURCE.repositoryId,
    commitId: SOURCE.headSha, ref: SOURCE.headSha, path, side: 'head', language: 'typescript',
    coverage: { patchComplete: true, status: 'supported', addedLines: 1, eligibleLines: 1, skippedBlank: 0 },
    explanationMethod: 'linear-logodds-line-v1', explanationUnit: 'logit',
    contributionCaveat: '行级特征贡献，不是缺陷原因。',
    artifactSha256: 'd'.repeat(64), intercept: -1,
    lines: [{ rank: 1, path, side: 'head', line, text: 'return value', score: .6, logit: .4, languageContribution: .2,
      contributions: [{ feature: 'return', label: 'return 语句', value: 1, weight: .4, contribution: .4, direction: 'increases' }],
      contributionTotal: .4, otherContribution: 0 }],
    caveats: ['研究预览，不是缺陷概率。'],
  }
}
function response(body: unknown) { return Response.json(body) }

it('binds evidence to the current file and keeps a late old-file response out', async () => {
  let resolveFirst: (value: Response) => void = () => {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('path=src%2Fone.ts')) return new Promise<Response>(resolve => { resolveFirst = resolve })
    return response(result('src/two.ts', 11))
  })
  const view = render(<PRLineEvidence source={SOURCE} file={file('src/one.ts')}/>)
  expect(screen.getByText(/正在读取当前文件/)).toBeVisible()
  view.rerender(<PRLineEvidence source={SOURCE} file={file('src/two.ts')}/>)
  expect(await screen.findByText(/第 11 行排序分数/)).toBeVisible()
  resolveFirst(response(result('src/one.ts')))
  await waitFor(() => expect(screen.queryByText(/第 7 行排序分数/)).not.toBeInTheDocument())
  expect(screen.getByText(/当前文件/)).toHaveTextContent('src/two.ts')
})

it('shows unsupported-language instead of a zero result', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
    ...result('src/one.py'), status: 'unsupported-language', reason: 'unsupported-language',
    language: null, artifactSha256: null, intercept: null, lines: [],
  }))
  render(<PRLineEvidence source={SOURCE} file={file('src/one.py')}/>)
  expect(await screen.findByText(/当前文件语言不在研究模型覆盖范围/)).toBeVisible()
  expect(screen.queryByText(/风险为 0/)).not.toBeInTheDocument()
})
