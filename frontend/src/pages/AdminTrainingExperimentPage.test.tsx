import { render, screen, waitFor } from '../test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'

afterEach(() => vi.restoreAllMocks())

function session(path: string) {
  return String(path).endsWith('/api/admin/session') ? Response.json({ authenticated: true, username: 'admin' }) : null
}

const SPLIT_POLICY = { id: 'temporal-70-15-15', ratios: { train: 70, validation: 15, test: 15 }, timezone: 'UTC' }

function task(id: string, method: string, parameters: Record<string, unknown>, history: unknown) {
  return {
    taskId: id,
    datasetVersion: 'repo-v1',
    datasetManifest: 'data/demo.json',
    manifestSha256: 'a'.repeat(64),
    method,
    metricSet: 'metric-set-v2',
    status: 'succeeded',
    stage: 'completed',
    error: null,
    parentTaskId: null,
    createdBy: 'admin',
    requestId: 'req-1',
    artifactKey: `training-task-${id}`,
    artifactRunId: 'b'.repeat(64),
    runId: `run-${id}`,
    modelId: `model-${id}`,
    featureSchemaVersion: 'kamei14-git-v1',
    metrics: { averagePrecision: { value: 0.5, reason: null }, rocAuc: { value: 0.7, reason: null }, f1: { value: 0.4, reason: null }, precision: { value: 0.6, reason: null }, recall: { value: 0.3, reason: null } },
    metricsByPartition: { test: {} },
    split: { test: {} },
    splitPreset: 'temporal-70-15-15',
    splitPolicy: SPLIT_POLICY,
    splitRule: 'UTC',
    dataScale: { records: 10 },
    trainingPerformance: { durationSeconds: 1.5, trainingRecords: 7 },
    experimentId: 'exp-1',
    parameters,
    trainingHistory: history,
    classPolicy: null,
    classPolicySummary: null,
    createdAt: '2026-11-09T00:00:00Z',
    updatedAt: '2026-11-09T00:00:00Z',
    startedAt: '2026-11-09T00:00:00Z',
    deadlineAt: '2026-11-09T01:00:00Z',
    cancelRequestedAt: null,
    completedAt: '2026-11-09T00:01:00Z',
    queuePosition: null,
  }
}

const EXPERIMENT = {
  experimentId: 'exp-1',
  datasetVersion: 'repo-v1',
  datasetManifest: 'data/demo.json',
  manifestSha256: 'a'.repeat(64),
  metricSet: 'metric-set-v2',
  splitPreset: 'temporal-70-15-15',
  classPolicy: null,
  seed: 2026,
  requestId: 'req-1',
  createdBy: 'admin',
  createdAt: '2026-11-09T00:00:00Z',
  status: 'succeeded',
  statusCounts: { queued: 0, running: 0, succeeded: 2, failed: 0, cancelled: 0, interrupted: 0 },
  tasks: [
    task('t1', 'logistic-regression-l2-v1', { C: 0.5, max_iter: 1000, seed: 2026, threads: 1 }, null),
    task('t2', 'mlp-v1', { epochs: 2, lr: 0.001, hidden: [64, 32], seed: 2026, threads: 1 }, {
      unit: 'epoch', epochs: 2, complete: true, method: 'mlp-v1',
      entries: [{ epoch: 1, trainLoss: 0.6, seconds: 0.1 }, { epoch: 2, trainLoss: 0.5, seconds: 0.1 }],
    }),
  ],
}

const COMPARISON = {
  format: 'training-experiment-comparison-v1',
  experimentId: 'exp-1',
  datasetVersion: 'repo-v1',
  manifestSha256: 'a'.repeat(64),
  metricSet: 'metric-set-v2',
  splitPreset: 'temporal-70-15-15',
  classPolicy: null,
  seed: 2026,
  status: 'succeeded',
  comparable: true,
  notes: [],
  methods: EXPERIMENT.tasks.map(item => ({
    taskId: item.taskId, method: item.method, methodName: item.method === 'mlp-v1' ? '多层感知机（2 隐层）' : '逻辑回归 · L2',
    category: item.method === 'mlp-v1' ? 'deep' : 'classic', parameters: item.parameters, status: 'succeeded',
    stage: 'completed', error: null, metrics: item.metrics, metricsByPartition: item.metricsByPartition,
    trainingSeconds: 1.5, runId: item.runId, modelId: item.modelId,
    manifestSha256: 'a'.repeat(64), splitPreset: 'temporal-70-15-15', classPolicy: null, metricSet: 'metric-set-v2',
  })),
}

it('shows experiment comparison and the real epoch history', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    const value = String(path)
    if (value.includes('/comparison')) return Response.json(COMPARISON)
    if (value.includes('/api/v1/training-experiments/')) return Response.json(EXPERIMENT)
    return Response.json({})
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training-experiment', resourceId: 'exp-1' }} navigate={navigate}/>)
  expect(await screen.findByText('logistic-regression-l2-v1')).toBeVisible()
  await waitFor(() => expect(screen.getAllByText('0.500').length).toBeGreaterThan(0))
  await waitFor(() => expect(screen.getByText('训练曲线')).toBeVisible())
  expect(screen.getByText('该方法是单次拟合，无逐 epoch 曲线。')).toBeVisible()
  expect(screen.getByText(/各方法使用相同数据与切分成员/)).toBeVisible()
})
