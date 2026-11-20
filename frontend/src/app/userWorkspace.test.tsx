import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyDataPage } from '@/features/datasets/pages/MyDataPage'
import { MyModelsPage } from '@/features/models/pages/MyModelsPage'
import { UserAccount } from '@/features/account/components/UserAccount'
import { MyTrainingPage } from '@/features/training/pages/MyTrainingPage'

afterEach(() => vi.restoreAllMocks())

const DATASET = {
  version: 'kamei14-git-v2-demo-2026-01-01_2026-10-01', dataset: 'demo', schema: 'kamei14-git-v2',
  timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
  quality: { rawRows: 20, includedRows: 18, positiveLabels: 5, excluded: { merges: 2 } },
  file: { name: 'demo.csv', sha256: 'a'.repeat(64), bytes: 100 },
  source: { url: 'https://github.com/example/demo' }, labelRule: 'szz-full-v1', limitations: [],
  mine: true, shared: false, usage: 'branch', fieldCount: 14, featureFields: ['ns', 'la', 'nf'],
  timestamps: { registeredAt: '2026-10-01T00:00:00Z', builtAt: '2026-10-01T00:00:00Z', importedAt: null, ownedAt: '2026-10-01T00:00:00Z' },
}
const SPLIT = {
  datasetVersion: DATASET.version, schemaName: 'kamei14-git-v2', timezone: 'UTC', datasetRecords: 18,
  preset: { id: 'temporal-70-15-15', ratios: { train: 70, validation: 15, test: 15 }, timezone: 'UTC' },
  available: true, reason: null,
  partitions: { train: { records: 12, positives: 3, start: '2026-01-01', end: '2026-06-01' },
    validation: { records: 3, positives: 1, start: '2026-06-02', end: '2026-08-01' },
    test: { records: 3, positives: 1, start: '2026-08-02', end: '2026-10-01' } },
}
const METHODS = { schema: 'kamei14-git-v2', methods: [{ method: 'logistic-regression-l2-v1', name: '逻辑回归 · L2', label: '逻辑回归', category: 'classic', available: true, supportedSchema: true, reason: null, requires: [], params: [{ name: 'C', type: 'float', min: 0.01, max: 100, default: 1 }] }] }

it('sends a logged-out visitor to the login page', async () => {
  const navigate = vi.fn()
  render(<UserAccount session={null} onChange={vi.fn()} navigate={navigate} route={{ name: 'repositories' }}/>)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '登录 / 注册' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'login', role: 'user' })
})

it('shows data details and sends training to the training workspace', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [] })
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    return Response.json({})
  })
  render(<MyDataPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible()
  expect(await screen.findByText('可用于训练')).toBeVisible()
  expect(screen.getByText('原始行数')).toBeVisible()
  expect(screen.getByText('合并提交')).toBeVisible()
  expect(screen.queryByText('观察协议')).not.toBeInTheDocument()
  expect(screen.queryByText('mature-observed-v1')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /逻辑回归/ })).not.toBeInTheDocument()
  const user = userEvent.setup()
  const train = screen.getByRole('button', { name: '用于训练' })
  await waitFor(() => expect(train).toBeEnabled())
  await user.click(train)
  expect(navigate).toHaveBeenCalledWith({ name: 'my-training', datasetVersion: DATASET.version })
})

it('shows recent repository builds and their retry actions', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [{
      taskId: 'task-1', repositoryId: null, repositoryUrl: 'https://github.com/example/other',
      branch: 'main', since: null, until: null, commitLimit: 2000, status: 'failed',
      stage: 'collecting', error: { code: 'COLLECT_FAILED', message: '采集失败' },
      parentTaskId: null, datasetName: null, datasetVersion: null, manifestSha256: null,
      quality: null, reused: false, headCommit: null, createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:01:00Z', completedAt: null, queuePosition: null,
    }] })
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    return Response.json({})
  })
  render(<MyDataPage navigate={vi.fn()} onLoginRequired={vi.fn()} initialTab="builds"/>)
  expect(await screen.findByText('最近构建')).toBeVisible()
  expect(screen.getByText('example/other')).toBeVisible()
  expect(screen.getByRole('button', { name: '重试' })).toBeVisible()
})

it('opens the build queue even before the first dataset exists', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [] })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [{
      taskId: 'task-1', repositoryId: null, repositoryUrl: 'https://github.com/example/first',
      branch: 'main', since: null, until: null, commitLimit: 2000, status: 'running',
      stage: 'collecting', error: null, parentTaskId: null, datasetName: null,
      datasetVersion: null, manifestSha256: null, quality: null, reused: false,
      headCommit: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:01:00Z',
      completedAt: null, queuePosition: null,
    }] })
    return Response.json({})
  })
  render(<MyDataPage navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText('还没有数据')).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: /构建/ }))
  expect(await screen.findByText('example/first')).toBeVisible()
  expect(screen.getByText('采集中')).toBeVisible()
})

it('opens the active build progress dialog from a task deep link', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [] })
    if (value.endsWith('/api/v1/user/dataset-builds/task-1')) return Response.json({
      taskId: 'task-1', repositoryId: null, repositoryUrl: 'https://github.com/example/first',
      branch: 'main', since: null, until: null, commitLimit: 2000, status: 'running',
      stage: 'collecting', error: null, parentTaskId: null, datasetName: null,
      datasetVersion: null, manifestSha256: null, quality: null, reused: false,
      headCommit: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:01:00Z',
      completedAt: null, queuePosition: null,
    })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [] })
    return Response.json({})
  })
  render(<MyDataPage navigate={vi.fn()} onLoginRequired={vi.fn()} initialTaskId="task-1"/>)
  const dialog = await screen.findByRole('dialog', { name: '数据集构建任务' })
  expect(await within(dialog).findByText('构建流程')).toBeVisible()
  expect(await within(dialog).findByRole('button', { name: '取消任务' })).toBeVisible()
})

it('keeps active training distinct and filters the history by method and status', async () => {
  const facts = {
    datasetVersion: DATASET.version, datasetManifest: 'demo.json', manifestSha256: 'a'.repeat(64),
    metricSet: 'metric-set-v2', createdBy: 'demo', createdAt: '2026-10-01T00:00:00Z',
    seed: 7, splitPreset: 'temporal-70-15-15',
  }
  const makeExperiment = (id: string, method: string, status: string) => ({
    ...facts, experimentId: id, status,
    tasks: [{ ...facts, taskId: id, method, status, stage: status, error: null,
      metrics: null, updatedAt: facts.createdAt, queuePosition: null }],
  })
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ experiments: [
    makeExperiment('live', 'wide-deep-v1', 'running'),
    makeExperiment('finished', 'decision-tree-v1', 'succeeded'),
    makeExperiment('failed', 'logistic-regression-l2-v1', 'failed'),
  ] }))
  render(<MyTrainingPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const live = within(await screen.findByRole('region', { name: '当前训练' }))
  const records = within(screen.getByRole('region', { name: '训练记录' }))
  expect(records.queryByText('宽深双塔')).not.toBeInTheDocument()
  const user = userEvent.setup()
  await user.type(records.getByRole('textbox', { name: '搜索训练记录' }), 'decision-tree')
  expect(records.getAllByRole('link')).toHaveLength(1)
  await user.click(records.getByRole('link', { name: /决策树/ }))
  expect(navigate).toHaveBeenLastCalledWith({ name: 'my-training', experimentId: 'finished' })
  await user.clear(records.getByRole('textbox'))
  await user.click(records.getByRole('radio', { name: '异常与中止' }))
  expect(records.getAllByRole('link')).toHaveLength(1)
  expect(records.getByRole('link', { name: /逻辑回归/ })).toBeVisible()
  await user.click(live.getByRole('link', { name: '查看训练' }))
  expect(navigate).toHaveBeenLastCalledWith({ name: 'my-training', experimentId: 'live' })
})

it('follows real epoch updates and hides comparison while fewer than two tasks have succeeded', async () => {
  const facts = {
    datasetVersion: DATASET.version, datasetManifest: 'demo.json', manifestSha256: 'a'.repeat(64),
    metricSet: 'metric-set-v2', createdBy: 'demo', createdAt: '2026-10-01T00:00:00Z',
  }
  let reads = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const active = ++reads === 1
    return Response.json({
      ...facts, experimentId: 'demo-exp', status: active ? 'running' : 'succeeded',
      seed: 7, splitPreset: 'temporal-70-15-15',
      tasks: [{ ...facts, taskId: 'demo-task', method: 'wide-deep-v1',
        status: active ? 'running' : 'succeeded', stage: active ? 'running' : 'completed',
        error: null, metrics: active ? null : { averagePrecision: { value: 0.42 } }, updatedAt: facts.createdAt, queuePosition: null,
        trainingHistory: {
          unit: 'epoch', epochs: 2, complete: !active,
          entries: active ? [{ epoch: 1, trainLoss: 0.71, seconds: 1 }] : [
            { epoch: 1, trainLoss: 0.71, seconds: 1 }, { epoch: 2, trainLoss: 0.65, seconds: 1 },
          ],
        } }],
    })
  })
  render(<MyTrainingPage experimentId="demo-exp" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('button', { name: '取消' })).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '训练轮次进度' })).toHaveAttribute('aria-valuenow', '50')
  expect(screen.queryByRole('button', { name: '登记本次模型' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '登记本次模型' })).toBeEnabled(), { timeout: 6_000 })
  expect(screen.getByRole('progressbar', { name: '训练轮次进度' })).toHaveAttribute('aria-valuenow', '100')
  expect(screen.getByText('0.420')).toBeVisible()
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/comparison'))).toBe(false)
  expect(reads).toBeGreaterThanOrEqual(2)
})

it('previews and derives a cleaned dataset version', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [] })
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    if (value.includes('/curation/preview') && options?.method === 'POST') return Response.json({
      sourceVersion: DATASET.version, recipeSha256: 'c'.repeat(64),
      stats: { rawRows: 20, includedRows: 18, excludedRows: 2, positiveLabels: 5, timeRange: null, excluded: { duplicate: 2 }, sampleExcluded: [] },
    })
    if (value.includes('/curation/derive') && options?.method === 'POST') return Response.json({
      dataset: { version: 'demo-cleaned' },
      preview: { sourceVersion: DATASET.version, recipeSha256: 'c'.repeat(64),
        stats: { rawRows: 20, includedRows: 18, excludedRows: 2, positiveLabels: 5, timeRange: null, excluded: { duplicate: 2 }, sampleExcluded: [] } },
    })
    return Response.json({})
  })
  render(<MyDataPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '清洗数据' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: '预览结果' }))
  expect(await screen.findByText('清洗预览')).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: '生成新版本' }))
  expect(await screen.findByText('已生成清洗版本')).toBeVisible()
})

it('starts a new experiment from my training', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const value = String(input)
    if (value.includes('/api/v1/user/training-experiments') && options?.method === 'GET') return Response.json({ experiments: [] })
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/training-methods')) return Response.json(METHODS)
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    if (value.endsWith('/api/v1/user/training-experiments') && options?.method === 'POST') {
      return Response.json({ experimentId: 'e1', datasetVersion: DATASET.version, datasetManifest: 'm', manifestSha256: 'b'.repeat(64), metricSet: 'metric-set-v2', splitPreset: 'temporal-70-15-15', classPolicy: null, seed: 2026, requestId: null, createdBy: 'reader', createdAt: '2026-11-09T00:00:00Z', status: 'queued', statusCounts: {}, tasks: [] })
    }
    return Response.json({})
  })
  render(<MyTrainingPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始训练' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: '选择训练方法' }))
  await user.click(await screen.findByRole('checkbox', { name: /逻辑回归/ }))
  await user.click(screen.getByRole('button', { name: '完成' }))
  await user.click(within(dialog).getByRole('button', { name: '开始训练（1 个方法）' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-training', experimentId: 'e1' }))
})

it('lists only the signed-in user models', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ models: [{
    modelId: 'm1', name: '逻辑回归 · kamei14-git-v2（C=0.6）', method: 'logistic-regression-l2-v1',
    featureSchemaVersion: 'kamei14-git-v2', state: 'ready', enabled: true,
    parameters: { C: 0.6, seed: 2026 }, datasetVersion: 'demo',
  }] }))
  render(<MyModelsPage navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect((await screen.findAllByText(/逻辑回归/)).length).toBeGreaterThan(0)
})
