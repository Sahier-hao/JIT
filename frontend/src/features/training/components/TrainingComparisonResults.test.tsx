import { fireEvent, render, screen, within } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
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

it('renders the test comparison, train and validation details, and failures', () => {
  render(<TrainingComparisonResults comparison={COMPARISON}/>)
  expect(screen.getByRole('heading', { name: '模型对比' })).toBeVisible()
  const details = screen.getByText('模型参数与训练详情', { exact: true }).closest('details')
  expect(details).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('模型参数与训练详情', { exact: true }))
  expect(screen.getAllByRole('heading', { name: '逻辑回归' }).length).toBeGreaterThan(0)
  expect(screen.getByRole('heading', { name: '决策树' })).toBeVisible()
  expect(screen.getAllByText('训练集').length).toBeGreaterThan(0)
  expect(screen.getAllByText('验证集').length).toBeGreaterThan(0)
  expect(screen.getByText(/记录 10 · 正例 4/)).toBeInTheDocument()
  expect(within(screen.getByRole('table', { name: '模型性能对比' })).getByText('测试分区没有足够类别')).toBeVisible()
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

it('switches performance metrics and requests frozen tests for the chosen pair', async () => {
  const preview = {
    positives: 2, negatives: 2, defaultThreshold: .5,
    truePositives: Array.from({ length: 101 }, (_, tick) => tick <= 60 ? 2 : 0),
    falsePositives: Array.from({ length: 101 }, (_, tick) => tick <= 30 ? 2 : 0),
  }
  const evaluation = { precision: metric(1), recall: metric(1), f1: metric(1), confusion: { tp: 2, fp: 0, tn: 2, fn: 0 } }
  const compare = vi.fn().mockRejectedValueOnce(new Error('测试产物暂不可用')).mockResolvedValue({
    experimentId: COMPARISON.experimentId, selection: { strategy: 'max-f1' },
    methods: [{ taskId: 'task-1' }, { taskId: 'task-2' }].map(({ taskId }) => ({
      taskId, threshold: .6, defaultThreshold: .5, validation: evaluation, test: evaluation, defaultTest: evaluation,
    })),
  })
  const onExport = vi.fn()
  const comparison = { ...COMPARISON, status: 'succeeded' as const,
    methods: COMPARISON.methods.map(method => ({ ...method, status: 'succeeded' as const, error: null,
      splitMemberSha256: 'c'.repeat(64),
      metricsByPartition: { ...COMPARISON.methods[0].metricsByPartition,
        validation: { ...COMPARISON.methods[0].metricsByPartition?.validation as object, thresholdPreview: preview } },
    })) }
  render(<TrainingComparisonResults comparison={comparison} onEvaluateThresholds={compare} onExport={onExport}/>)
  const table = screen.getByRole('table', { name: '模型性能对比' })
  expect(table).toHaveTextContent('AP')
  expect(screen.queryByLabelText('模型一')).toBeNull()
  fireEvent.click(screen.getByText('阈值调整评估'))
  fireEvent.click(screen.getByRole('radio', { name: '召回率' }))
  expect(screen.getByRole('img', { name: '验证集召回率随阈值变化' })).toBeVisible()
  expect(table).toHaveTextContent('0.400')
  fireEvent.change(screen.getByLabelText('阈值选择方式'), { target: { value: 'max-f1' } })
  fireEvent.click(screen.getByRole('button', { name: '用选定阈值评估测试集' }))
  expect(compare).toHaveBeenCalledWith({ taskIds: ['task-1', 'task-2'], strategy: 'max-f1' }, expect.any(AbortSignal))
  expect(await screen.findByRole('alert')).toHaveTextContent('测试产物暂不可用')
  fireEvent.click(screen.getByRole('button', { name: '用选定阈值评估测试集' }))
  const results = await screen.findByRole('region', { name: '测试集阈值结果' })
  expect(results).toHaveTextContent('0.60')
  expect(results).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: '导出比较' }))
  expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ experimentId: COMPARISON.experimentId }))
})
