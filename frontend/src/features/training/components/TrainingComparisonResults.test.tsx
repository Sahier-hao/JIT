import { render, screen } from '@/lib/test-utils'
import { expect, it } from 'vitest'
import { TrainingComparisonResults } from '@/features/training/components/TrainingComparisonResults'
import { comparisonExportText } from '@/features/training/trainingComparison'
import type { TrainingExperimentComparison } from '@/features/admin/adminContracts'

const metric = (value: number | null, reason: string | null = null) => ({ value, reason })

const COMPARISON: TrainingExperimentComparison = {
  format: 'training-experiment-comparison-v1',
  experimentId: 'experiment-1',
  datasetVersion: 'dataset-v1',
  manifestSha256: 'a'.repeat(64),
  metricSet: 'metric-set-v2',
  splitPreset: 'temporal-70-15-15',
  classPolicy: null,
  seed: 2026,
  status: 'partial',
  comparable: true,
  notes: [],
  methods: [{
    taskId: 'task-1',
    method: 'logistic-regression-l2-v1',
    methodName: '逻辑回归 · L2',
    category: 'classic',
    parameters: { C: 0.5, max_iter: 1000, seed: 2026, threads: 1 },
    status: 'succeeded',
    stage: 'completed',
    error: null,
    metrics: metric(.6),
    metricsByPartition: {
      train: { counts: { records: 10, positive: 4 }, averagePrecision: metric(.82), rocAuc: metric(.9), f1: metric(.7) },
      validation: { counts: { records: 4, positive: 2 }, averagePrecision: metric(.55), rocAuc: metric(.65), f1: metric(.5) },
      test: { counts: { records: 3, positive: 1 }, averagePrecision: metric(null, '测试分区没有足够类别'), rocAuc: metric(.6), f1: metric(.4) },
    },
    trainingSeconds: 1.25,
    runId: 'run-1',
    modelId: null,
    manifestSha256: 'a'.repeat(64),
    splitPreset: 'temporal-70-15-15',
    classPolicy: null,
    metricSet: 'metric-set-v2',
  }, {
    taskId: 'task-2',
    method: 'decision-tree-v1',
    methodName: '决策树 · CART',
    category: 'classic',
    parameters: { max_depth: 4, seed: 2026, threads: 1 },
    status: 'failed',
    stage: 'training',
    error: { code: 'MODEL_NOT_CONVERGED', message: '未收敛' },
    metrics: null,
    metricsByPartition: null,
    trainingSeconds: null,
    runId: null,
    modelId: null,
    manifestSha256: 'a'.repeat(64),
    splitPreset: 'temporal-70-15-15',
    classPolicy: null,
    metricSet: 'metric-set-v2',
  }],
}

it('renders all methods with three explicit partition results and failures', () => {
  render(<TrainingComparisonResults comparison={COMPARISON}/>)
  expect(screen.getByRole('heading', { name: '三档结果比较' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '逻辑回归 · L2' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '决策树 · CART' })).toBeVisible()
  expect(screen.getAllByText('训练档').length).toBeGreaterThan(0)
  expect(screen.getAllByText('验证档').length).toBeGreaterThan(0)
  expect(screen.getAllByText('测试档').length).toBeGreaterThan(0)
  expect(screen.getByText(/记录 10 · 正例 4/)).toBeVisible()
  expect(screen.getByText('测试分区没有足够类别')).toBeVisible()
  expect(screen.getByText('MODEL_NOT_CONVERGED · 未收敛')).toBeVisible()
  expect(screen.getByText(/max_depth=4/)).toBeVisible()
})

it('exports the same partition, failure and identity facts shown by the component', () => {
  const exported = JSON.parse(comparisonExportText(COMPARISON))
  expect(exported.methods[0].metricsByPartition.train.counts).toEqual({ records: 10, positive: 4 })
  expect(exported.methods[0].metricsByPartition.test.averagePrecision.reason).toBe('测试分区没有足够类别')
  expect(exported.methods[1].error).toEqual({ code: 'MODEL_NOT_CONVERGED', message: '未收敛' })
  expect(exported.manifestSha256).toBe('a'.repeat(64))
})
