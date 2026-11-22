import { render, screen, waitFor } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
import { MyTrainingPage } from '@/features/training/pages/MyTrainingPage'

const facts = {
  datasetVersion: 'dataset-v1',
  datasetManifest: 'dataset.json',
  manifestSha256: 'a'.repeat(64),
  metricSet: 'metric-set-v2',
  splitPreset: 'temporal-70-15-15',
  classPolicy: null,
  seed: 2026,
  createdBy: 'reader',
  createdAt: '2026-11-20T00:00:00Z',
}

function task(id: string, method: string) {
  return {
    ...facts,
    taskId: id,
    method,
    status: 'succeeded',
    stage: 'completed',
    error: null,
    queuePosition: null,
    metrics: { averagePrecision: { value: 0.5, reason: null } },
    metricsByPartition: {
      train: { counts: { records: 8, positive: 4 }, averagePrecision: { value: 0.8, reason: null }, rocAuc: { value: 0.9, reason: null } },
      validation: { counts: { records: 3, positive: 1 }, averagePrecision: { value: 0.6, reason: null } },
      test: { counts: { records: 2, positive: 1 }, averagePrecision: { value: null, reason: '测试集缺少负例' } },
    },
    trainingPerformance: { durationSeconds: 0.5 },
    updatedAt: '2026-11-20T00:00:01Z',
    parameters: null,
    runId: null,
    modelId: null,
  }
}

it('shows all three partitions in the user-owned experiment comparison', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/comparison')) return Response.json({
      ...facts,
      format: 'training-experiment-comparison-v1',
      experimentId: 'exp-1',
      status: 'succeeded',
      comparable: true,
      notes: [],
      methods: [task('t1', 'logistic-regression-l2-v1'), task('t2', 'decision-tree-v1')].map(item => ({
        taskId: item.taskId,
        method: item.method,
        methodName: item.method === 'decision-tree-v1' ? '决策树 · CART' : '逻辑回归 · L2',
        category: 'classic',
        parameters: item.parameters,
        status: item.status,
        stage: item.stage,
        error: item.error,
        metrics: item.metrics,
        metricsByPartition: item.metricsByPartition,
        trainingSeconds: item.trainingPerformance.durationSeconds,
        runId: item.runId,
        modelId: item.modelId,
        manifestSha256: item.manifestSha256,
        splitPreset: item.splitPreset,
        classPolicy: item.classPolicy,
        metricSet: item.metricSet,
      })),
    })
    return Response.json({
      ...facts,
      experimentId: 'exp-1',
      status: 'succeeded',
      statusCounts: { succeeded: 2 },
      tasks: [task('t1', 'logistic-regression-l2-v1'), task('t2', 'decision-tree-v1')],
    })
  })
  render(<MyTrainingPage experimentId="exp-1" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '训练实验' })).toBeVisible()
  expect(await screen.findByRole('heading', { name: '三档结果比较' })).toBeVisible()
  await waitFor(() => expect(screen.getAllByText('训练档').length).toBeGreaterThan(0))
  expect(screen.getAllByText('验证档').length).toBeGreaterThan(0)
  expect(screen.getAllByText('测试档').length).toBeGreaterThan(0)
  expect(screen.getAllByText(/记录 8 · 正例 4/).length).toBeGreaterThan(0)
  expect(screen.getAllByText('测试集缺少负例').length).toBeGreaterThan(0)
})
