import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyDataPage } from '@/features/datasets/pages/MyDataPage'
import { MyModelsPage } from '@/features/models/pages/MyModelsPage'
import { UserAccount } from '@/features/account/components/UserAccount'
import { MyTrainingPage } from '@/features/training/pages/MyTrainingPage'
import { useActiveUserJobs } from '@/features/account/activeJobs'
import { ActiveJobsIndicator } from '@/components/layout/ActiveJobsIndicator'

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
  await user.click(screen.getByRole('button', { name: '查看训练记录' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-training', historyDatasetVersion: DATASET.version })
})

it('opens the data version linked by a training record, including shared data', async () => {
  const shared = { ...DATASET, dataset: 'shared data', version: 'shared-version', mine: false, shared: true }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET, shared] })
    if (url.includes('/split-preview')) return Response.json(SPLIT)
    return Response.json({ tasks: [] })
  })
  render(<MyDataPage initialDatasetVersion={shared.version} navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: 'shared data' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'demo' })).not.toBeInTheDocument()
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
          entries: active ? [{ epoch: 1, trainLoss: 0.71, validationLoss: 0.48, seconds: 1 }] : [
            { epoch: 1, trainLoss: 0.71, validationLoss: 0.48, seconds: 1 }, { epoch: 2, trainLoss: 0.65, validationLoss: 0.59, seconds: 1 },
          ],
        } }],
    })
  })
  render(<MyTrainingPage experimentId="demo-exp" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('button', { name: '取消' })).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '训练轮次进度' })).toHaveAttribute('aria-valuenow', '50')
  expect(screen.queryByRole('button', { name: '登记为可用模型' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '登记为可用模型' })).toBeEnabled(), { timeout: 6_000 })
  expect(screen.getByRole('progressbar', { name: '训练轮次进度' })).toHaveAttribute('aria-valuenow', '100')
  expect(screen.getByText('0.420')).toBeVisible()
  expect(screen.getByText('第 1 轮 · 0.4800')).toBeVisible()
  expect(screen.getByText('已保存结果')).toBeVisible()
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/comparison'))).toBe(false)
  expect(reads).toBeGreaterThanOrEqual(2)
})

it('switches to the accepted retry while the experiment is refreshing', async () => {
  const facts = {
    datasetVersion: DATASET.version, datasetManifest: 'demo.json', manifestSha256: 'a'.repeat(64),
    metricSet: 'metric-set-v2', createdBy: 'reader', createdAt: '2026-10-01T00:00:00Z',
  }
  const finished = { ...facts, taskId: 'interrupted-task', experimentId: 'retry-exp', method: 'ft-transformer-v1',
    metrics: null, status: 'interrupted', stage: 'interrupted', queuePosition: null, updatedAt: facts.createdAt,
    error: { code: 'TRAINING_INTERRUPTED', message: '服务重启时训练尚未完成' } }
  const retry = { ...finished, taskId: 'retry-task', parentTaskId: finished.taskId, status: 'queued', stage: 'queued',
    queuePosition: 1, error: null }
  let reads = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).endsWith('/retry')) return Response.json(retry)
    if (++reads > 1) return new Promise<Response>(() => undefined)
    return Response.json({ ...facts, experimentId: 'retry-exp', status: 'interrupted', seed: 7,
      splitPreset: 'temporal-70-15-15', tasks: [finished] })
  })
  const user = userEvent.setup()
  render(<MyTrainingPage account="reader" experimentId="retry-exp" navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  const reason = await screen.findByRole('region', { name: '训练停止原因' })
  expect(within(reason).getByText('服务重启时训练尚未完成')).toBeVisible()
  expect(within(reason).getByText('重试会创建新任务，从头训练。')).toBeVisible()
  await user.click(within(reason).getByRole('button', { name: '重试' }))
  expect(await screen.findByText('队列第 1 位')).toBeVisible()
  expect(screen.queryByText('服务重启时训练尚未完成')).not.toBeInTheDocument()
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
      beforeStats: { rawRows: 20, includedRows: 20, excludedRows: 0, positiveLabels: 6, timeRange: null, excluded: {}, sampleExcluded: [] },
      featureComparison: [{
        field: 'la',
        bins: [{ start: 1, end: 10 }, { start: 10, end: 20 }],
        before: { records: 20, present: 20, missing: 0, mean: 9, median: 8, min: 1, max: 20, bucketCounts: [12, 8] },
        after: { records: 18, present: 18, missing: 0, mean: 8, median: 7, min: 1, max: 18, bucketCounts: [11, 7] },
      }],
      steps: [{
        index: 1,
        rule: { id: 'quantile-range', field: 'la', lower: 0.05, upper: 0.95 },
        details: { la: { min: 1, max: 20, lower: 0.05, upper: 0.95 } },
        beforeStats: { rawRows: 20, includedRows: 20, excludedRows: 0, positiveLabels: 6, timeRange: null, excluded: {}, sampleExcluded: [] },
        afterStats: { rawRows: 20, includedRows: 18, excludedRows: 2, positiveLabels: 5, timeRange: null, excluded: { duplicate: 2 }, sampleExcluded: [] },
        featureComparison: [{
          field: 'la',
          bins: [{ start: 1, end: 10 }, { start: 10, end: 20 }],
          before: { records: 20, present: 20, missing: 0, mean: 9, median: 8, min: 1, max: 20, bucketCounts: [12, 8] },
          after: { records: 18, present: 18, missing: 0, mean: 8, median: 7, min: 1, max: 18, bucketCounts: [11, 7] },
        }],
      }],
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
  expect(screen.getByText('数据集变化')).toBeVisible()
  expect(screen.getByText('指定特征变化')).toBeVisible()
  expect(screen.getByRole('img', { name: '每一步清洗前后的记录数' })).toBeVisible()
  expect(screen.getByRole('img', { name: 'la 在步骤 1 前后的分布' })).toBeVisible()
  const lower = within(dialog).getByLabelText('下分位百分比')
  await user.clear(lower)
  await user.type(lower, '10')
  expect(screen.getByText('操作已变化，请重新预览。')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: '生成新版本' })).toBeDisabled()
  await user.click(within(dialog).getByRole('button', { name: '预览结果' }))
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '生成新版本' })).toBeEnabled())
  await user.click(within(dialog).getByRole('button', { name: '生成新版本' }))
  expect(await screen.findByText('已生成清洗版本')).toBeVisible()
})

it('adds and reorders dataset preprocessing operations', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/api/v1/user/dataset-builds?')) return Response.json({ tasks: [] })
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    return Response.json({})
  })
  render(<MyDataPage navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '清洗数据' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getAllByRole('article')).toHaveLength(1)
  await user.click(within(dialog).getByRole('button', { name: '添加操作' }))
  await user.click(await screen.findByRole('menuitem', { name: '保留日期范围' }))
  expect(within(dialog).getAllByRole('article')).toHaveLength(2)
  expect(within(dialog).getByLabelText('开始日期')).toHaveTextContent('2026-01-01')
  await user.click(within(dialog).getAllByRole('button', { name: '上移' })[1])
  expect(within(dialog).getAllByRole('article')[0]).toHaveTextContent('保留日期范围')
  await user.click(within(dialog).getAllByRole('button', { name: '删除操作' })[0])
  expect(within(dialog).getAllByRole('article')).toHaveLength(1)
  expect(within(dialog).getByText('保留分位区间')).toBeVisible()
})

it('shows submission feedback and immediately publishes the accepted training to the header', async () => {
  const navigate = vi.fn()
  let accept: () => void = () => undefined
  function Header() {
    return <ActiveJobsIndicator jobs={useActiveUserJobs('reader')} navigate={navigate}/>
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const value = String(input)
    if (value.includes('/api/v1/user/training-experiments') && options?.method === 'GET') return Response.json({ experiments: [] })
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/training-methods')) return Response.json(METHODS)
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    if (value.endsWith('/api/v1/user/training-experiments') && options?.method === 'POST') {
      await new Promise<void>(resolve => { accept = resolve })
      return Response.json({ experimentId: 'e1', datasetVersion: DATASET.version, datasetManifest: 'm', manifestSha256: 'b'.repeat(64), metricSet: 'metric-set-v2', splitPreset: 'temporal-70-15-15', classPolicy: null, seed: 2026, requestId: null, createdBy: 'reader', createdAt: '2026-11-09T00:00:00Z', status: 'queued', statusCounts: {}, tasks: [] })
    }
    return Response.json({})
  })
  render(<><Header/><MyTrainingPage account="reader" navigate={navigate} onLoginRequired={vi.fn()}/></>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始训练' }))
  const dialog = await screen.findByRole('dialog')
  await user.click(await within(dialog).findByRole('checkbox', { name: /逻辑回归/ }))
  await user.click(within(dialog).getByRole('button', { name: '开始训练（1 个方法）' }))
  expect(within(dialog).getByRole('button', { name: '正在提交训练…' })).toBeDisabled()
  expect(navigate).not.toHaveBeenCalled()
  accept()
  expect(await screen.findByRole('button', { name: /返回训练任务/ })).toBeVisible()
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-training', experimentId: 'e1' }))
})

it('lists only the signed-in user models', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ models: [{
    modelId: 'm1', name: '逻辑回归 · kamei14-git-v2（C=0.6）', method: 'logistic-regression-l2-v1',
    featureSchemaVersion: 'kamei14-git-v2', state: 'ready', enabled: true,
    parameters: { C: 0.6, seed: 2026 }, datasetVersion: 'demo', mine: true, shared: false,
  }] }))
  render(<MyModelsPage navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect((await screen.findAllByText(/逻辑回归/)).length).toBeGreaterThan(0)
})

it('separates my models from administrator-opened models', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ models: [
    {
      modelId: 'mine', name: '我的逻辑回归', method: 'logistic-regression-l2-v1',
      featureSchemaVersion: 'kamei14-git-v2', state: 'ready', enabled: true,
      parameters: { C: 0.6 }, datasetVersion: 'demo', mine: true, shared: true,
    },
    {
      modelId: 'shared', name: '管理员决策树', method: 'decision-tree-v1',
      featureSchemaVersion: 'kamei14-git-v2', state: 'ready', enabled: true,
      parameters: { max_depth: 4 }, datasetVersion: 'shared-data', mine: false, shared: true,
    },
  ] }))
  render(<MyModelsPage navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  const mine = await screen.findByRole('region', { name: '我的模型' })
  const shared = await screen.findByRole('region', { name: '管理员开放的模型' })
  expect(within(mine).getByText('我的逻辑回归')).toBeVisible()
  expect(within(mine).getByText('已开放')).toBeVisible()
  expect(within(shared).getByText('管理员决策树')).toBeVisible()
  expect(within(shared).queryByText('打开训练数据')).not.toBeInTheDocument()
})
