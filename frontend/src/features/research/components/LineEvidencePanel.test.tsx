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
  coverage: { patchComplete: true, status: 'supported', addedLines: 2, eligibleLines: 2, skippedBlank: 0,
    textSource: 'patch', usesFullFile: false },
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

it('renders a plain-language ranking and hides technical decomposition until requested', async () => {
  const user = userEvent.setup()
  render(<LineEvidencePanel result={RESULT}/>)
  expect(screen.getByRole('heading', { name: '行级研究排序' })).toBeVisible()
  expect(screen.getByText(/这一行在 2 个改动行中排第 1 位/)).toBeVisible()
  expect(screen.getAllByText(/不是缺陷概率/).length).toBeGreaterThan(0)
  expect(screen.getByRole('list', { name: '候选行排序' })).toBeVisible()
  await user.click(screen.getByText('技术口径与完整贡献'))
  expect(screen.getByRole('table')).toBeVisible()
  await user.click(screen.getByText('模型限制与来源（2）'))
  expect(screen.getByText('行级特征贡献，不是缺陷原因。')).toBeVisible()
})

it('switches candidate rows and handles no nonzero contribution without a fake chart', async () => {
  const user = userEvent.setup()
  render(<LineEvidencePanel result={RESULT}/>)
  await user.click(screen.getByRole('button', { name: /L3/ }))
  expect(screen.getByText(/这一行在 2 个改动行中排第 2 位/)).toBeVisible()
  expect(screen.getByText('该行没有非零的行内特征，不渲染空条形图。')).toBeVisible()
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
