import { act, render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'

afterEach(() => vi.restoreAllMocks())

const NOW = '2026-10-30T10:00:00Z'
const TASK = {
  taskId: '22222222-2222-4222-8222-222222222222',
  datasetVersion: 'mp-scikit-learn-2022-01-02_2024-12-30',
  datasetManifest: 'data/datasets/mp-scikit-learn/manifest.json',
  manifestSha256: 'a'.repeat(64),
  method: 'logistic-regression-l2-v1',
  metricSet: 'metric-set-v2',
  status: 'succeeded',
  stage: 'completed',
  error: null,
  parentTaskId: null,
  createdBy: 'admin',
  requestId: 'request-1',
  artifactKey: 'training-task-example',
  artifactRunId: 'b'.repeat(64),
  runId: '33333333-3333-4333-8333-333333333333',
  modelId: '44444444-4444-4444-8444-444444444444',
  featureSchemaVersion: 'kamei14-git-v1',
  metrics: {
    averagePrecision: { value: 0.42, reason: null },
    rocAuc: { value: 0.71, reason: null },
    recall20Loc: { value: 0.12, reason: null },
    popt: { value: 0.8, reason: null },
    f1: { value: 0.31, reason: null },
    ifa: { value: 2, reason: null },
  },
  createdAt: NOW,
  updatedAt: NOW,
  startedAt: NOW,
  deadlineAt: NOW,
  cancelRequestedAt: null,
  completedAt: NOW,
  queuePosition: null,
}

const DATASET = {
  dataset: 'mp-scikit-learn',
  versions: [{
    version: TASK.datasetVersion,
    schema: 'kamei14-git-v1',
    timeRange: { start: '2022-01-02T00:00:00Z', end: '2024-12-30T00:00:00Z', startEpoch: 1, endEpoch: 2 },
    quality: {
      rawRows: 4300, includedRows: 4210, positiveLabels: 1301, blankLabels: 0,
      featureMissing: { lt: 0, age: 0 },
      excluded: { outsideWindow: 0, noAddedLines: 90, tooMuchChurn: 0, tooManyFiles: 0, missingRequiredField: 0 },
    },
    file: { name: 'mp-scikit-learn.csv', path: 'data/collected/mp-scikit-learn.csv', sha256: 'c'.repeat(64), bytes: 509179 },
    manifestPath: 'data/datasets/mp-scikit-learn/manifest.json',
    source: { publisher: 'collected', url: 'https://github.com/scikit-learn/scikit-learn', revision: 'd'.repeat(40), citation: 'git', branch: 'main', head: 'e'.repeat(40), window: null },
    labelRule: 'szz-simple-v1',
    limitations: ['特征为提交级聚合', '标签为简化 SZZ'],
  }],
}

function session(path: string) {
  return String(path).endsWith('/api/admin/session') ? Response.json({ authenticated: true, username: 'admin' }) : null
}

it('loads a successful training task with metrics and lineage', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => session(String(path)) ?? Response.json(TASK))
  render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '训练任务详情' })).toBeVisible()
  expect(screen.getByText('0.4200')).toBeVisible()
  expect(screen.getByText(TASK.runId)).toBeVisible()
  expect(screen.getByText(TASK.modelId)).toBeVisible()
})

it('retries a failed task through the management API', async () => {
  const failed = { ...TASK, status: 'failed', stage: 'training', error: { code: 'MODEL_NOT_CONVERGED', message: '未收敛' }, metrics: null, runId: null, modelId: null, artifactRunId: null }
  const queued = { ...failed, taskId: '55555555-5555-4555-8555-555555555555', parentTaskId: TASK.taskId, status: 'queued', stage: 'queued', error: null }
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => session(String(path)) ?? (options?.method === 'POST' ? Response.json(queued) : Response.json(failed)))
  render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={navigate}/>)
  await userEvent.setup().click(await screen.findByRole('button', { name: '重试' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'training', resourceId: queued.taskId }))
})

it('cancels an active task and shows the terminal state', async () => {
  const queued = { ...TASK, status: 'queued', stage: 'queued', metrics: null, runId: null, modelId: null, artifactRunId: null, queuePosition: 1 }
  const cancelled = { ...queued, status: 'cancelled', stage: 'cancelled', queuePosition: null, cancelRequestedAt: NOW, completedAt: NOW }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => session(String(path)) ?? (options?.method === 'POST' ? Response.json(cancelled) : Response.json(queued)))
  render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={vi.fn()}/>)
  await userEvent.setup().click(await screen.findByRole('button', { name: '取消任务' }))
  expect(await screen.findByText('已取消')).toBeVisible()
})

it('keeps an actionable error visible when cancellation fails', async () => {
  const running = { ...TASK, status: 'running', stage: 'training', metrics: null, runId: null, modelId: null, artifactRunId: null }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    const auth = session(String(path))
    if (auth) return auth
    if (options?.method === 'POST') return Response.json({ error: { code: 'WORKER_EXITED', message: '取消请求未被服务接受', requestId: 'cancel-request' } }, { status: 503 })
    return Response.json(running)
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={vi.fn()}/>)
  await userEvent.setup().click(await screen.findByRole('button', { name: '取消任务' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('取消请求未被服务接受')
})

it('polls an active task list and stops after it reaches a terminal state', async () => {
  let listCalls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    listCalls += 1
    const status = listCalls === 1 ? 'queued' : 'succeeded'
    return Response.json({ tasks: [{ ...TASK, status, stage: status, metrics: status === 'succeeded' ? TASK.metrics : null }], total: 1, limit: 20, offset: 0 })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('排队中')).toBeVisible()
  await waitFor(() => expect(screen.getByText('成功')).toBeVisible(), { timeout: 4500 })
  expect(listCalls).toBe(2)
  await new Promise(resolve => window.setTimeout(resolve, 3200))
  expect(listCalls).toBe(2)
})

it('shows loading and empty states', async () => {
  let release: ((response: Response) => void) | undefined
  let waitingForInitialLoad = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    if (waitingForInitialLoad) {
      waitingForInitialLoad = false
      return new Promise(resolve => { release = resolve })
    }
    return Response.json({ tasks: [], total: 0, limit: 20, offset: 0 })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('正在读取训练任务')).toBeVisible()
  await act(async () => {
    release?.(Response.json({ tasks: [], total: 0, limit: 20, offset: 0 }))
  })
  expect(await screen.findByText('尚无训练任务。请从数据集详情创建。')).toBeVisible()
})

it('shows an error state and keeps its recovery action keyboard focusable', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    return Response.json({ error: { code: 'STORAGE_UNAVAILABLE', message: '训练任务存储暂不可用', requestId: 'list-request' } }, { status: 503 })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('训练任务不可用')).toBeVisible()
  expect(screen.getByText('训练任务存储暂不可用')).toBeVisible()
  const retry = screen.getByRole('button', { name: '重试' })
  const user = userEvent.setup()
  retry.focus()
  expect(retry).toHaveFocus()
  await user.tab()
  expect(retry).not.toHaveFocus()
})

it('creates a training task from a dataset detail page', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    const auth = session(String(path))
    if (auth) return auth
    if (String(path).endsWith('/api/v1/datasets')) return Response.json({ datasets: [DATASET] })
    if (String(path).endsWith('/api/v1/models')) return Response.json({ models: [], methods: [{ method: 'logistic-regression-l2-v1', name: '逻辑回归' }] })
    if (String(path).endsWith('/api/v1/model-candidates')) return Response.json({ candidates: [] })
    if (String(path).endsWith('/api/v1/training-tasks') && options?.method === 'POST') {
      return Response.json({ ...TASK, status: 'queued', stage: 'queued', metrics: null, runId: null, modelId: null, artifactRunId: null })
    }
    return Response.json(DATASET)
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'datasets', resourceId: 'mp-scikit-learn', version: TASK.datasetVersion }} navigate={navigate}/>)
  expect(await screen.findByText('4300 / 4210', {}, { timeout: 3000 })).toBeVisible()
  expect(screen.getByText('1301')).toBeVisible()
  expect(screen.getByText('特征为提交级聚合')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '创建训练任务' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'training', resourceId: TASK.taskId }))
})

it('shows model metrics and compares two models without declaring a winner', async () => {
  const models = [
    { modelId: 'm1', name: '模型甲', method: 'lr', state: 'ready', enabled: true, isDefault: true, featureSchemaVersion: 'kamei14-git-v1', runId: 'r1', artifactRunId: 'a1', artifactDatasetVersion: 'd1' },
    { modelId: 'm2', name: '模型乙', method: 'rf', state: 'ready', enabled: true, isDefault: false, featureSchemaVersion: 'kamei14-git-v1', runId: 'r2', artifactRunId: 'a2', artifactDatasetVersion: 'd2' },
  ]
  const detail = (model: typeof models[number]) => ({ ...model, metrics: { averagePrecision: { value: model.modelId === 'm1' ? 0.4 : 0.5, reason: null }, rocAuc: { value: 0.7, reason: null }, ifa: { value: null, reason: '测试正例不足' } }, trainingSeconds: 1, threshold: 0.5, metricSet: 'metric-set-v2', artifactKey: model.modelId, split: {}, source: { publisher: model.modelId }, limitations: [] })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    if (String(path).endsWith('/api/v1/models')) return Response.json({ models, methods: [] })
    if (String(path).includes('/api/v1/models/m1')) return Response.json(detail(models[0]))
    if (String(path).includes('/api/v1/models/m2')) return Response.json(detail(models[1]))
    return Response.json({ candidates: [] })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'comparisons', models: ['m1', 'm2'] }} navigate={vi.fn()}/>)
  expect(await screen.findByText('0.4000')).toBeVisible()
  expect(screen.getByText('0.5000')).toBeVisible()
  expect(screen.getAllByText('测试正例不足')).toHaveLength(2)
  expect(screen.queryByText(/最佳模型/)).not.toBeInTheDocument()
})

it('shows the documented reason when a model metric is unavailable', async () => {
  const model = {
    modelId: 'm1', name: '模型甲', method: 'lr', state: 'ready', enabled: true, isDefault: true,
    featureSchemaVersion: 'kamei14-git-v1', runId: 'r1', artifactRunId: 'a1', artifactDatasetVersion: 'd1',
    artifactKey: 'kamei14-v1', trainingSeconds: 1, threshold: 0.5, metricSet: 'metric-set-v2',
    metrics: { averagePrecision: { value: null, reason: '测试分区没有正例' } },
    split: {}, source: { publisher: 'collected' }, limitations: [],
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => session(String(path)) ?? Response.json(model))
  render(<AdminWorkspace route={{ name: 'admin', view: 'models', resourceId: 'm1' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('测试分区没有正例')).toBeVisible()
  expect(screen.getAllByText('未定义').length).toBeGreaterThan(0)
})

it('keeps an unavailable model detail error actionable', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    return Response.json({ error: { code: 'ARTIFACT_UNAVAILABLE', message: '模型产物缺失', requestId: 'model-request' } }, { status: 503 })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models', resourceId: 'missing' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('模型详情不可用')).toBeVisible()
  expect(screen.getByText('模型产物缺失')).toBeVisible()
  expect(screen.getByRole('button', { name: '返回模型列表' })).toBeVisible()
})

it('pages past the first twenty training tasks', async () => {
  const tasks = Array.from({ length: 45 }, (_, index) => ({ ...TASK, taskId: `task-${index}`, datasetVersion: `dataset-${index}` }))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    const url = new URL(String(path), 'http://localhost')
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return Response.json({ tasks: tasks.slice(offset, offset + 20), total: tasks.length, limit: 20, offset })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training' }} navigate={vi.fn()}/>)
  await userEvent.setup().click(await screen.findByRole('button', { name: '下一页' }))
  expect(await screen.findByText('第 2 页 · 共 45 条')).toBeVisible()
  expect(screen.getByText('dataset-20')).toBeVisible()
  expect(fetch.mock.calls.some(([path]) => String(path).includes('offset=20'))).toBe(true)
  await userEvent.setup().click(screen.getByRole('button', { name: '下一页' }))
  expect(await screen.findByText('第 3 页 · 共 45 条')).toBeVisible()
  expect(screen.getByText('dataset-40')).toBeVisible()
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
})

it('clears the previous task detail when returning to the list', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    if (String(path).includes(`/training-tasks/${TASK.taskId}`)) return Response.json(TASK)
    return Response.json({ tasks: [TASK], total: 1, limit: 20, offset: 0 })
  })
  const view = render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '训练任务详情' })).toBeVisible()
  view.rerender(<AdminWorkspace route={{ name: 'admin', view: 'training' }} navigate={vi.fn()}/>)
  await waitFor(() => expect(screen.queryByRole('heading', { name: '训练任务详情' })).not.toBeInTheDocument())
  expect(await screen.findByRole('heading', { name: '训练任务' })).toBeVisible()
})

it('reissues a real request when a task read fails and the user retries', async () => {
  let detailCalls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    detailCalls += 1
    if (detailCalls === 1) return Response.json({ error: { code: 'STORAGE_UNAVAILABLE', message: '训练任务暂时不可用', requestId: 'task-request' } }, { status: 503 })
    return Response.json(TASK)
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'training', resourceId: TASK.taskId }} navigate={vi.fn()}/>)
  expect(await screen.findByText('训练任务暂时不可用')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByRole('heading', { name: '训练任务详情' })).toBeVisible()
  expect(detailCalls).toBe(2)
})
