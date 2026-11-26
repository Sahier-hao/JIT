import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { LineEvidencePanel } from '@/features/research/components/LineEvidencePanel'
import type { LineReviewEvidence } from '@/features/research/lineEvidence'

const RESULT: LineReviewEvidence = {
  status: 'supported',
  reason: null,
  sourceKind: 'repository-commit',
  resourceId: 'repository-1',
  repositoryId: 'repository-1',
  commitId: 'a'.repeat(40),
  ref: 'a'.repeat(40),
  path: 'src/value.ts',
  side: 'head',
  language: 'typescript',
  coverage: { patchComplete: true, status: 'supported', addedLines: 2, eligibleLines: 2, skippedBlank: 0 },
  explanationMethod: 'linear-logodds-line-v1',
  explanationUnit: 'logit',
  contributionCaveat: '行级特征贡献，不是缺陷原因。',
  artifactSha256: 'b'.repeat(64),
  intercept: -1,
  lines: [
    {
      rank: 1, path: 'src/value.ts', side: 'head', line: 12, text: 'return value',
      score: .8, logit: 1.386, languageContribution: .2,
      contributions: [
        { feature: 'lineLength', label: '行长', value: 12, weight: 2, contribution: 24, direction: 'increases' },
        { feature: 'return', label: 'return 语句', value: 1, weight: -1.4, contribution: -1.4, direction: 'decreases' },
      ],
      contributionTotal: 22.6, otherContribution: 0,
    },
    {
      rank: 2, path: 'src/value.ts', side: 'head', line: 3, text: 'const value = 1',
      score: .4, logit: -.405, languageContribution: .2,
      contributions: [],
      contributionTotal: 0, otherContribution: 0,
    },
  ],
  caveats: ['研究预览，不是缺陷概率。'],
}

it('renders bars, equivalent table and evidence-only template summary', async () => {
  render(<LineEvidencePanel result={RESULT}/>)
  expect(screen.getByRole('heading', { name: '行级研究证据' })).toBeVisible()
  expect(screen.getByRole('list', { name: '第 12 行前 3 个 log-odds 特征贡献' })).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getAllByText('行长').length).toBeGreaterThanOrEqual(2)
  expect(screen.getByText(/第 12 行排序分数为 0.8000/)).toBeVisible()
  expect(screen.getByText('行级特征贡献，不是缺陷原因。')).toBeVisible()
  expect(screen.getByText(/不求和、不统一排名/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /最佳/ })).not.toBeInTheDocument()
})

it('switches candidate rows and handles no nonzero contribution without a fake chart', async () => {
  const user = userEvent.setup()
  render(<LineEvidencePanel result={RESULT}/>)
  await user.click(screen.getByRole('button', { name: /L3/ }))
  expect(screen.getByText(/第 3 行排序分数为 0.4000/)).toBeVisible()
  expect(screen.getByText('该行没有非零特征贡献，不渲染空条形图。')).toBeVisible()
  expect(screen.queryByRole('list', { name: /第 3 行前 3/ })).not.toBeInTheDocument()
})

it('shows the stable unavailable reason instead of rows', () => {
  render(<LineEvidencePanel result={{
    ...RESULT,
    status: 'patch-incomplete',
    reason: 'patch-incomplete',
    language: null,
    artifactSha256: null,
    intercept: null,
    lines: [],
  }}/>)
  expect(screen.getByText(/固定 patch 不完整/)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
