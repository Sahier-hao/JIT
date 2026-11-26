import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LineResearchPage } from '@/features/research/pages/LineResearchPage'

afterEach(() => vi.restoreAllMocks())

const metadata = {
  schema: 'line-preview-metadata-v1',
  available: true,
  languages: ['javascript', 'typescript'],
  training: { repos: ['JIT', 'cc-switch'], commits: 249, samples: 6102, positives: 2435 },
  holdout: { repo: 'axios', commits: 120, samples: 2152, positives: 1125 },
  metrics: { rocAuc: 0.658, prAuc: 0.659, brier: 0.233, randomPrAuc: 0.523 },
  localization: { proxy: true, top5: 0.933, recallAt20PercentLines: 0.26 },
  model: { positionFeatures: false, textFeatures: false, threshold: 0.5 },
  features: { language: ['typescript'], numeric: ['lineLength'] },
  coefficientCount: 20,
  artifactSha256: 'a'.repeat(64),
  generatedAt: '2026-11-09T00:00:00Z',
  limitations: ['历史 SZZ 弱标签。', '分数未做概率校准。'],
  caveats: ['分数来自弱标签抽样，不是缺陷概率。'],
  limits: { maxLines: 2000, maxCharacters: 200000 },
}

const score = {
  schema: 'line-preview-score-v1',
  language: 'typescript',
  lines: [
    {
      rank: 1, line: 2, text: 'eval("x")', score: 0.62, logit: 0.49,
      contributionTotal: 0.977, otherContribution: 0.12,
      contributions: [
        { feature: 'language:typescript', value: 1, weight: -0.487, contribution: -0.487 },
        { feature: 'call', value: 1, weight: 0.35, contribution: 0.35 },
        { feature: 'lineLength', value: 9, weight: 0.011, contribution: 0.099 },
      ],
    },
    {
      rank: 2, line: 1, text: 'const a = 1', score: 0.41, logit: -0.36,
      contributionTotal: 0.127, otherContribution: 0.05,
      contributions: [
        { feature: 'indent', value: 0, weight: 0.058, contribution: 0 },
        { feature: 'assign', value: 1, weight: 0.122, contribution: 0.122 },
        { feature: 'lineLength', value: 11, weight: 0.0036, contribution: 0.04 },
      ],
    },
  ],
  count: 2,
  skippedBlank: 0,
  intercept: -0.487,
  contributionUnit: 'logit',
  contributionCaveat: '行级特征贡献，不是缺陷原因。',
  artifactSha256: 'a'.repeat(64),
  caveats: ['不是缺陷概率。'],
}

function mockFetch(metadataBody: unknown = metadata, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.endsWith('/api/v1/research/line-model/score')) return Response.json(score)
    if (url.endsWith('/api/v1/research/line-model')) return Response.json(metadataBody, { status })
    return Response.json({})
  })
}

it('shows the research evidence and scores pasted code', async () => {
  mockFetch()
  render(<LineResearchPage navigate={vi.fn()}/>)
  expect(await screen.findByText(/JIT、cc-switch · 249 提交 · 6,102 行/)).toBeVisible()
  expect(screen.getByRole('note')).toHaveTextContent('不是缺陷概率')
  expect(screen.getByText('0.659 · 随机基线 0.523')).toBeVisible()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('代码'), 'const a = 1\neval("x")')
  await user.click(screen.getByRole('button', { name: '分析这些行' }))
  expect(await screen.findByRole('table')).toBeVisible()
  expect(screen.getByText('eval("x")')).toBeVisible()
  expect(screen.getByText('0.620')).toBeVisible()
  await user.click(screen.getByRole('button', { name: /第 2 行.*展开特征贡献/ }))
  expect(screen.getByText('行级特征贡献，不是缺陷原因。')).toBeVisible()
  expect(screen.getByText('TypeScript 语言项')).toBeVisible()
  expect(screen.getByText('调用')).toBeVisible()
  expect(screen.getByText('贡献 -0.487')).toBeVisible()
  await user.click(screen.getByRole('button', { name: /第 2 行.*收起特征贡献/ }))
  expect(screen.queryByText('行级特征贡献，不是缺陷原因。')).not.toBeInTheDocument()
})

it('keeps the ranking readable when an older response has no contributions', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.endsWith('/api/v1/research/line-model/score')) {
      const lines = score.lines.map(item => Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== 'contributions'),
      ))
      return Response.json({ ...score, lines })
    }
    return Response.json(metadata)
  })
  render(<LineResearchPage navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('代码'), 'const a = 1\neval("x")')
  await user.click(screen.getByRole('button', { name: '分析这些行' }))
  expect(await screen.findByText('eval("x")')).toBeVisible()
  expect(screen.getByRole('button', { name: /第 2 行.*展开特征贡献/ })).toBeDisabled()
})

it('keeps an explicit unavailable state when the artifact cannot load', async () => {
  mockFetch({ error: { code: 'LINE_PREVIEW_UNAVAILABLE', message: '行级研究预览模型不可用', requestId: 'r1' } }, 503)
  render(<LineResearchPage navigate={vi.fn()}/>)
  expect(await screen.findByRole('alert')).toHaveTextContent('行级研究预览模型不可用')
  expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
})
