import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
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

it('keeps training focused on process, parameters and model handoff', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/comparison')) throw new Error('训练页不读取评估结果')
    return Response.json({
      ...facts,
      experimentId: 'exp-1',
      status: 'succeeded',
      statusCounts: { succeeded: 2 },
      tasks: [task('t1', 'logistic-regression-l2-v1'), task('t2', 'decision-tree-v1')],
    })
  })
  const navigate = vi.fn()
  render(<MyTrainingPage experimentId="exp-1" navigate={navigate} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '训练实验' })).toBeVisible()
  expect(await screen.findByText('单次拟合已完成')).toBeVisible()
  expect(screen.getByRole('button', { name: '登记到模型库' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: '模型对比' })).not.toBeInTheDocument()
  expect(screen.queryByRole('slider', { name: '缺陷阈值' })).not.toBeInTheDocument()

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '算法说明' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'algorithms', method: 'logistic-regression-l2-v1' })
})

it('registers one exact model and opens its evaluation', async () => {
  let registered = false
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input)
    calls.push(path)
    const current = {
      ...task('t1', 'logistic-regression-l2-v1'),
      modelId: registered ? 'model-1' : null,
      runId: registered ? 'run-1' : null,
    }
    if (path.endsWith('/tasks/t1/register') && options?.method === 'POST') {
      registered = true
      return Response.json({ status: 'registered', modelId: 'model-1', runId: 'run-1' })
    }
    return Response.json({
      ...facts,
      experimentId: 'exp-1',
      status: 'succeeded',
      statusCounts: { succeeded: 1 },
      tasks: [current],
    })
  })
  const navigate = vi.fn()
  render(<MyTrainingPage experimentId="exp-1" navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '登记到模型库' }))
  expect(calls.some(path => path.endsWith('/training-experiments/exp-1/tasks/t1/register'))).toBe(true)
  const evaluate = await screen.findByRole('button', { name: '评估本次训练' })
  await user.click(evaluate)
  expect(navigate).toHaveBeenCalledWith({
    name: 'model-evaluation',
    source: 'training',
    experimentId: 'exp-1',
    taskId: 't1',
    modelId: 'model-1',
  })
})

it('ignores a delayed experiment response after switching objects', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    const old = {
      ...facts,
      experimentId: 'exp-a',
      datasetVersion: 'dataset-a',
      datasetManifest: 'a.json',
      status: 'succeeded',
      statusCounts: { succeeded: 1 },
      tasks: [{ ...task('task-a', 'logistic-regression-l2-v1'), experimentId: 'exp-a' }],
    }
    const next = {
      ...facts,
      experimentId: 'exp-b',
      datasetVersion: 'dataset-b',
      datasetManifest: 'b.json',
      status: 'succeeded',
      statusCounts: { succeeded: 1 },
      tasks: [{ ...task('task-b', 'decision-tree-v1'), experimentId: 'exp-b' }],
    }
    if (path.endsWith('/exp-a')) {
      await new Promise(resolve => setTimeout(resolve, 120))
      return Response.json(old)
    }
    return Response.json(next)
  })
  const view = render(<MyTrainingPage experimentId="exp-a" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  view.rerender(<MyTrainingPage experimentId="exp-b" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect((await screen.findAllByText('决策树')).length).toBeGreaterThan(0)
  await new Promise(resolve => setTimeout(resolve, 160))
  expect(screen.queryByText('逻辑回归')).not.toBeInTheDocument()
})
