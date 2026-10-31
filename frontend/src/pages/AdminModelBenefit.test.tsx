import { render, screen } from '../test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'
import { response } from '../projectActivity.fixture'

afterEach(() => vi.restoreAllMocks())

const MODEL = {
  modelId: 'm1', name: '逻辑回归', method: 'logistic-regression-l2-v1', state: 'ready', enabled: true,
  isDefault: false, featureSchemaVersion: 'openstack-six-v1', runId: 'run-1', artifactRunId: 'run-1',
  artifactDatasetVersion: 'data-1', artifactKey: 'baseline', metricSet: 'metric-set-v1', threshold: 0.5,
  metrics: {
    averagePrecision: { value: 0.38, reason: null }, rocAuc: { value: 0.77, reason: null },
    recall20Loc: { value: 0.04, reason: null }, popt: { value: null, reason: '既有密度序未定义' },
    f1: { value: 0.07, reason: null }, ifa: { value: null, reason: '没有正标签提交' },
  },
  split: { test: { count: 100, positiveCount: 10, start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' } },
  source: { publisher: 'publisher', url: 'https://example.invalid', revision: 'a'.repeat(40) },
  limitations: ['模型限制'],
}
const metric = (value: number | null, reason: string | null = null) => ({ value, reason })
const strategy = (recall: number, popt: number | null, ifa: number | null, covered: number) => ({
  ordering: 'x', recall20Loc: metric(recall), popt: metric(popt), ifa: metric(ifa),
  coverage: { positives: 10, totalLoc: 2000, budgetLoc: 400, selectedCount: 12, usedLoc: 390,
    issuesCovered: covered, precisionAtBudget: metric(covered / 12) },
})
const REPORT = {
  reportId: 'benefit-1', source: 'docs/evidence/benefit-evaluation/baseline/benefit-report.json',
  kind: 'model-benefit-evaluation', reportVersion: 1, generatedUtc: '2026-10-31T00:00:00Z',
  artifact: { runId: 'run-1', artifactPath: 'artifacts/baseline', artifactKey: 'baseline', datasetVersion: 'data-1',
    schema: 'openstack-six-v1', metricSet: 'metric-set-v1', model: { id: 'lr', name: '逻辑回归' }, modelSha256: 'b'.repeat(64) },
  test: { records: 100, positives: 10, negatives: 90, totalLoc: 2000, budgetLoc: 400, startEpoch: 1, endEpoch: 2,
    split: {}, source: { labelRule: 'bugcount > 0' } },
  strategies: {
    model: strategy(0.1, 0.29, 0, 1), time: strategy(0.2, 0.46, 3, 2),
    random: { runs: 200, seed: 2026, recall20Loc: { mean: 0.15, std: 0.02, min: 0.1, max: 0.2, validRuns: 200, reason: null },
      ifa: { mean: 5.1, std: 1.2, min: 1, max: 9, validRuns: 200, reason: null },
      popt: { mean: 0.5, std: 0.01, min: 0.45, max: 0.55, validRuns: 200, reason: null },
      precisionAtBudget: { mean: 0.15, std: null, min: null, max: null, validRuns: 200, reason: null },
      coverage: { issuesCovered: { mean: 1.5, std: 0.2, min: 1, max: 3, validRuns: 200, reason: null },
        selectedCount: { mean: 30, std: 2, min: 20, max: 40, validRuns: 200, reason: null },
        usedLoc: { mean: 390, std: 5, min: 380, max: 399, validRuns: 200, reason: null } } },
  },
  comparisons: {}, conclusion: { sentence: '同样检查 20% 代码改动量：模型覆盖 10.0%，时间覆盖 20.0%，随机平均覆盖 15.0%。', recall20: {} },
  existingMetrics: { averagePrecision: { value: 0.38, reason: null }, recall20Loc: { value: 0.04, reason: null },
    popt: { value: null, reason: '既有密度序未定义' }, ifa: { value: null, reason: '没有正标签提交' } },
  parameterSelection: 'none; frozen artifact; test partition used only for evaluation',
  limitations: ['回顾性评估，不代表在线效果。', '标签来自历史观测，不是已证实缺陷。'],
  boundary: { retrospective: true, defectProbability: false }, sourceHashes: {},
}
function api(benefit: unknown = { available: true, modelId: 'm1', runId: 'run-1', reportId: 'benefit-1', source: REPORT.source, report: REPORT }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const url = String(path)
    if (url.endsWith('/api/admin/session')) return response({ authenticated: true, setupRequired: false, username: 'admin' })
    if (url.endsWith('/api/v1/models/m1/benefit')) return response(benefit)
    return response(MODEL)
  })
}

it('shows model, time and random review coverage with honest sample and label limits', async () => {
  api()
  render(<AdminWorkspace route={{ name: 'admin', view: 'models', resourceId: 'm1' }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '审查收益' })).toBeVisible()
  expect(await screen.findByText(/模型覆盖 10.0%，时间覆盖 20.0%/)).toBeVisible()
  expect(screen.getByText('模型分数')).toBeVisible()
  expect(screen.getByText('时间顺序')).toBeVisible()
  expect(screen.getByText(/随机（均值 ± 标准差）/)).toBeVisible()
  expect(screen.getByText('10.0%')).toBeVisible()
  expect(screen.getByText('20.0%')).toBeVisible()
  expect(screen.getByText('15.0%')).toBeVisible()
  expect(screen.getByText(/测试 100 条提交 · 10 个历史标记/)).toBeVisible()
  expect(screen.getByText(/只读回顾性评估；.*风险分数不是缺陷概率/)).toBeVisible()
  expect(screen.getByText('标签来自历史观测，不是已证实缺陷。')).toBeInTheDocument()
})

it('shows the documented reason when a strategy metric is undefined', async () => {
  const report = { ...REPORT, strategies: { ...REPORT.strategies,
    model: { ...REPORT.strategies.model, recall20Loc: { value: null, reason: '测试分区没有正例' } } } }
  api({ available: true, modelId: 'm1', runId: 'run-1', reportId: 'benefit-1', source: REPORT.source, report })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models', resourceId: 'm1' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('测试分区没有正例')).toBeVisible()
  expect(screen.getAllByText('—').length).toBeGreaterThan(0)
})
it('does not invent a benefit result when the model has no report', async () => {
  api({ available: false, modelId: 'm1', runId: 'run-1', reason: '尚无该模型的收益评估报告' })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models', resourceId: 'm1' }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '审查收益' })).toBeVisible()
  expect(await screen.findByText('尚无该模型的收益评估报告')).toBeVisible()
  expect(screen.queryByText(/模型覆盖/)).not.toBeInTheDocument()
})
