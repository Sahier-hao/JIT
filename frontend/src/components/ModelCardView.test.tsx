import { render, screen } from '../test-utils'
import { expect, it } from 'vitest'
import { ModelCardView } from './ModelCardView'
import type { ModelCard } from '../modelCardClient'

function card(overrides: Partial<ModelCard> = {}): ModelCard {
  const metric = (value: number | null, reason: string | null = null) => ({ value, reason })
  return {
    available: true, reason: null, modelId: 'model-1', name: '决策树', method: 'decision-tree-v1',
    featureSchemaVersion: 'kamei14-git-v1', runId: 'run-1', artifactRunId: 'artifact-1',
    modelSha256: 'a'.repeat(64), datasetVersion: 'data-v1', datasetSha256: 'b'.repeat(64),
    metricSet: 'metric-set-v2', threshold: 0.5, splitRule: '时间切分 70/15/15',
    dataScale: { records: 30, featureWidth: 14 },
    trainingPerformance: { durationSeconds: 1.2, recordsPerSecond: 20 },
    diagnostics: { available: false, reason: '模型产物已直接记录三档指标' },
    source: { publisher: 'collected', revision: 'abc' },
    partitions: [
      { name: 'train', label: '拟合诊断', available: true, source: 'artifact', reason: null, metrics: { averagePrecision: metric(0.8), rocAuc: metric(0.9) }, records: 20, positives: 4, negatives: 16, start: null, end: null },
      { name: 'validation', label: '模型选择背景', available: true, source: 'artifact', reason: null, metrics: { averagePrecision: metric(0.7), rocAuc: metric(0.8) }, records: 5, positives: 2, negatives: 3, start: null, end: null },
      { name: 'test', label: '冻结泛化评价', available: true, source: 'artifact', reason: null, metrics: { averagePrecision: metric(0.6), rocAuc: metric(0.7) }, records: 5, positives: 2, negatives: 3, start: null, end: null },
    ],
    limitations: ['历史标签只表示未观测与已观测，不是完整缺陷事实。'],
    benefit: {
      available: true, reason: null, reportVersion: 2,
      conclusion: { sentence: '模型排序低于时间顺序和随机策略。' },
      test: { records: 5, positives: 2, budgetLoc: 20, totalLoc: 100 },
      boundary: { crossModelRanking: false },
      strategies: {
        model: { recall20Loc: metric(0.1), popt: metric(0.2), ifa: metric(3), coverage: { issuesCovered: 1, positives: 2 } },
        time: { recall20Loc: metric(0.3), popt: metric(0.4), ifa: metric(1), coverage: { issuesCovered: 2, positives: 2 } },
        random: { recall20Loc: { mean: 0.25, std: 0.05, reason: null }, popt: { mean: 0.35, std: 0.04, reason: null }, ifa: { mean: 2, std: 1, reason: null } },
      },
      limitations: ['回顾性评估，不代表在线效果。'],
    },
    ...overrides,
  }
}

it('separates fit, validation and frozen test evidence and shows adverse benefit', () => {
  render(<ModelCardView card={card()}/>)
  expect(screen.getByRole('heading', { name: '拟合诊断' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '模型选择背景' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '冻结泛化评价' })).toBeVisible()
  expect(screen.getByText('模型排序低于时间顺序和随机策略。')).toBeVisible()
  expect(screen.getByText('25.0%')).toBeVisible()
  expect(screen.queryByRole('button', { name: /设为默认|停用|重训/ })).not.toBeInTheDocument()
})

it('keeps unavailable reasons and missing partition evidence explicit', () => {
  render(<ModelCardView card={card({
    available: false,
    reason: '模型产物损坏',
    partitions: [
      { name: 'train', label: '拟合诊断', available: false, source: 'not-recorded', reason: '旧模型未记录训练指标', metrics: null, records: 20, positives: 4, negatives: 16, start: null, end: null },
      { name: 'validation', label: '模型选择背景', available: false, source: 'not-recorded', reason: '旧模型未记录验证指标', metrics: null, records: 5, positives: 2, negatives: 3, start: null, end: null },
      { name: 'test', label: '冻结泛化评价', available: true, source: 'artifact', reason: null, metrics: { averagePrecision: { value: null, reason: '测试分区没有正例' } }, records: 5, positives: 0, negatives: 5, start: null, end: null },
    ],
  })}/>)
  expect(screen.getAllByText('模型产物损坏').length).toBeGreaterThan(0)
  expect(screen.getByText('旧模型未记录训练指标')).toBeVisible()
  expect(screen.getByText('测试分区没有正例')).toBeVisible()
})
