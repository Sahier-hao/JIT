import { render, screen, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ModelEvaluationPage } from './ModelEvaluationPage'

afterEach(() => vi.restoreAllMocks())

const thresholds = () => Array.from({ length: 101 }, (_, index) => index / 100)
const preview = {
  thresholds: thresholds(),
  positives: 2,
  negatives: 2,
  truePositives: Array.from({ length: 101 }, (_, index) => index <= 50 ? 1 : 0),
  falsePositives: Array.from({ length: 101 }, (_, index) => index <= 40 ? 1 : 0),
  defaultThreshold: .5,
}

const comparison = {
  format: 'training-experiment-comparison-v1',
  experimentId: 'experiment-1',
  datasetVersion: 'dataset-v1',
  manifestSha256: 'a'.repeat(64),
  metricSet: 'metric-set-v2',
  splitPreset: 'temporal-custom-65-20-15',
  classPolicy: null,
  seed: 2026,
  status: 'succeeded',
  comparable: true,
  notes: [],
  methods: [{
    taskId: 'task-1', method: 'logistic-regression-l2-v1', methodName: '逻辑回归 · L2',
    category: 'classic', parameters: null, status: 'succeeded', stage: 'completed',
    error: null, metricsByPartition: { validation: { thresholdPreview: preview } },
    metrics: null, trainingSeconds: 1, runId: 'run-1', artifactRunId: 'artifact-1',
    modelId: 'model-1', manifestSha256: 'a'.repeat(64), splitMemberSha256: 'b'.repeat(64),
    splitPreset: 'temporal-custom-65-20-15', classPolicy: null, metricSet: 'metric-set-v2',
  }],
}

const classification = { tp: 1, fp: 1, tn: 1, fn: 1 }
const metric = { value: .5, reason: null }

it('evaluates one exact training model on the frozen test partition', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input)
    if (path.endsWith('/comparison')) return Response.json(comparison)
    if (path.endsWith('/comparison/thresholds') && options?.method === 'POST') {
      return Response.json({
        format: 'training-threshold-evaluation-v1',
        experimentId: 'experiment-1',
        datasetVersion: 'dataset-v1',
        manifestSha256: 'a'.repeat(64),
        splitMemberSha256: 'b'.repeat(64),
        selection: { strategy: 'fixed', threshold: .5 },
        methods: [{
          taskId: 'task-1', artifactRunId: 'artifact-1', runId: 'run-1',
          modelId: 'model-1', method: 'logistic-regression-l2-v1', threshold: .5,
          defaultThreshold: .5,
          validation: { precision: metric, recall: metric, f1: metric,
            confusion: { tp: 1, fp: 1, tn: 1, fn: 1 } },
          test: { precision: metric, recall: metric, f1: metric, confusion: classification },
          defaultTest: { precision: metric, recall: metric, f1: metric, confusion: classification },
          evaluation: {
            format: 'model-evaluation-v1', source: 'training', mode: 'formal',
            formalAvailable: true, formalUnavailableReason: null,
            partition: { kind: 'test', memberSha256: 'b'.repeat(64), labelSnapshot: true },
            labelPolicy: { version: 'mature-binary-v1',
              included: ['positive', 'unobserved'],
              excludedCounts: { immature: 2, unknown: 1, unrecorded: 0 } },
            sampleCounts: { included: 4, positives: 2, negatives: 2, excluded: 3 },
          },
        }],
      })
    }
    throw new Error(path)
  })
  render(<ModelEvaluationPage source="training" experimentId="experiment-1" taskId="task-1"
    modelId="model-1" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '评估本次训练' })).toBeVisible()
  expect(screen.getByRole('link', { name: /怎么看评估指标/ })).toHaveAttribute('href', '#/docs/labels-and-metrics?section=evaluation-metrics')
  expect(await screen.findByText('model-1')).toBeVisible()
  await userEvent.setup().click(await screen.findByRole('button', { name: '在测试集复核' }))
  const section = await screen.findByRole('region', { name: '测试集正式复核' })
  expect(within(section).getByText('正式评估')).toBeVisible()
  expect(within(section).getByRole('table', { name: '缺陷阈值指标表' })).toBeVisible()
  expect(within(section).getByText(/以下状态未进入指标/)).toBeVisible()
  expect(fetch.mock.calls.some(([path, options]) => String(path).endsWith('/comparison/thresholds')
    && options?.method === 'POST')).toBe(true)
})

it('reopens a saved prediction as an exploratory evaluation without inference', async () => {
  const batch = evaluationBase('batch-1', '逻辑回归 · 六字段')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/prediction-batches?limit=')) return Response.json({ batches: [] })
    if (path.endsWith('/prediction-batches/batch-1/evaluation')) return Response.json(batch)
    throw new Error(path)
  })
  render(<ModelEvaluationPage source="prediction" batchId="batch-1"
    navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '评估预测结果' })).toBeVisible()
  expect(await screen.findByText('探索性复核')).toBeVisible()
  expect(screen.getByText(/预测批次未声明固定测试分区/)).toBeVisible()
  expect(screen.getByText('immature 2')).toBeVisible()
  expect(screen.getByText('unknown 1')).toBeVisible()
  expect(screen.getByRole('table', { name: '缺陷阈值指标表' })).toBeVisible()
})

it('ignores a delayed response after the selected batch changes', async () => {
  const first = new Promise<Response>(resolve => {
    setTimeout(() => resolve(Response.json(evaluationBase('batch-a', '旧模型'))), 120)
  })
  const second = Response.json(evaluationBase('batch-b', '新模型'))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('prediction-batches?limit=')) {
      return Response.json({
        batches: [batchSummary('batch-a', '旧模型'), batchSummary('batch-b', '新模型')],
      })
    }
    return path.includes('/batch-a/evaluation') ? first : second
  })
  const view = render(<ModelEvaluationPage source="prediction" batchId="batch-a"
    navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  view.rerender(<ModelEvaluationPage source="prediction" batchId="batch-b"
    navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText('新模型')).toBeVisible()
  await new Promise(resolve => setTimeout(resolve, 160))
  expect(screen.queryByText('旧模型')).not.toBeInTheDocument()
})

function evaluationBase(batchId: string, name: string) {
  return {
    format: 'user-prediction-evaluation-v1',
    batchId, mode: 'batch', datasetVersion: 'dataset-v1', dataset: 'demo',
    source: { kind: 'dataset', label: '数据版本', reference: {} },
    sourceKind: 'dataset', splitPreset: null, partition: null, memberSha256: null,
    model: {
      modelId: `model-${batchId}`, name, method: 'logistic-regression-l2-v1',
      runId: `run-${batchId}`, featureSchemaVersion: 'openstack-six-v1',
      artifactDatasetVersion: 'dataset-v1', featureNames: ['ns'],
      isDefault: false, mine: true, shared: false,
    },
    threshold: .5,
    eligible: true, reason: '包含可用真实标签，可进入评估',
    counts: { records: 4, labeledAvailable: 4, unavailable: 0, positives: 2, negatives: 2, flagged: 2 },
    labelStatusCounts: { positive: 2, unobserved: 2, immature: 2, unknown: 1 },
    labelAvailabilityCounts: { available: 4, unavailable: 0 },
    thresholdPreview: preview,
    confusion: { tp: 1, fp: 1, tn: 1, fn: 1 },
    precision: .5, recall: .5, f1: .5,
    limitations: ['评估只使用成熟且可用的真实标签。'],
  }
}

function batchSummary(batchId: string, name: string) {
  return {
    batchId, datasetVersion: 'dataset-v1', dataset: 'demo',
    model: {
      modelId: `model-${batchId}`, name, method: 'logistic-regression-l2-v1',
      runId: `run-${batchId}`, featureSchemaVersion: 'openstack-six-v1',
      artifactDatasetVersion: 'dataset-v1', featureNames: ['ns'],
      isDefault: false, mine: true, shared: false,
    },
    threshold: .5,
    counts: { records: 4, labeledAvailable: 4, unavailable: 0, positives: 2, negatives: 2, flagged: 2 },
    labelStatusCounts: { positive: 2, unobserved: 2 },
    createdAt: '2026-11-20T00:00:00Z',
  }
}
