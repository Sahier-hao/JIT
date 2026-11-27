import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TrainingCreateDialog } from '@/features/training/components/TrainingCreateDialog'

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
  policy: { id: 'temporal-70-15-15', ratios: { train: 70, validation: 15, test: 15 },
    timezone: 'UTC', memberSha256: 'b'.repeat(64) },
  available: true, reason: null,
  partitions: {
    train: { records: 12, positives: 3, start: '2026-01-01', end: '2026-06-01' },
    validation: { records: 3, positives: 1, start: '2026-06-02', end: '2026-08-01' },
    test: { records: 3, positives: 1, start: '2026-08-02', end: '2026-10-01' },
  },
}

function choice(id: string, name: string, category: 'classic' | 'deep') {
  return {
    method: id, name, label: name, category,
    available: true, supportedSchema: true, reason: null,
    requires: [], detail: '冻结训练参数', preprocess: [],
    explanation: { method: 'occlusion-mean-v1', reason: null },
    guide: {
      summary: name + '按提交特征学习风险分。', strengths: ['结构清楚'], tradeoffs: ['需要验证'],
      whenToUse: '用于算法对照。', visual: null,
    },
    params: [],
  }
}

const METHODS = {
  schema: 'kamei14-git-v2',
  methods: [choice('decision-tree-v1', '决策树 · CART', 'classic'), choice('mlp-v1', '多层感知机', 'deep')],
}

function respond(input: RequestInfo | URL) {
  const path = String(input)
  if (path.includes('/training-methods')) return Response.json(METHODS)
  if (path.includes('/split-preview')) return Response.json(SPLIT)
  if (path.includes('/user/datasets')) return Response.json({ datasets: [DATASET] })
  return Response.json({})
}

it('preselects the method opened from the algorithm library', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => respond(input))
  render(<TrainingCreateDialog open initialMethod="mlp-v1" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)

  expect(await screen.findByText('已选 1 / 4')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: /多层感知机/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /决策树 · CART/ })).not.toBeChecked()
  expect(await screen.findByRole('button', { name: '开始训练（1 个方法）' })).toBeEnabled()
  expect(screen.getByText('多层感知机按提交特征学习风险分。')).toBeVisible()
})

it('shows the selected method in the algorithm library dialog', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => respond(input))
  render(<TrainingCreateDialog open initialMethod="mlp-v1" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)

  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '算法说明' }))

  await waitFor(() => expect(screen.getByText('本次所选')).toBeVisible())
  expect(screen.getByRole('heading', { name: /多层感知机/ })).toBeVisible()
  expect(screen.queryByRole('heading', { name: /决策树/ })).not.toBeInTheDocument()
})

it('explains, marks and restores a changed training parameter', async () => {
  const parameterized = {
    ...METHODS,
    methods: [{
      ...choice('mlp-v1', '多层感知机', 'deep'),
      params: [
        {
          name: 'C', label: '正则强度倒数 C', description: '数值越大，正则约束越弱。',
          type: 'float', min: 0.01, max: 100, default: 1,
        },
        {
          name: 'max_iter', label: '最大迭代次数', description: '不足时训练可能不收敛。',
          type: 'int', min: 100, max: 5000, default: 1000,
        },
      ],
    }],
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/training-methods')) return Response.json(parameterized)
    return respond(input)
  })
  render(<TrainingCreateDialog open initialMethod="mlp-v1" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)

  const user = userEvent.setup()
  await user.click(await screen.findByText('参数', { selector: 'summary' }))
  expect(screen.getByText('数值越大，正则约束越弱。')).toBeVisible()
  expect(screen.getByText('不足时训练可能不收敛。')).toBeVisible()
  expect(screen.getByText('默认 1')).toBeVisible()
  expect(screen.getByText('范围 0.01–100')).toBeVisible()
  const input = screen.getByLabelText('多层感知机 C')
  expect(input).toHaveValue(1)
  await user.clear(input)
  await user.type(input, '2')
  expect(screen.getByText('已修改')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '恢复 多层感知机 正则强度倒数 C 默认值' }))
  expect(input).toHaveValue(1)
  expect(screen.queryByText('已修改')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '查看 多层感知机 正则强度倒数 C 的算法库说明' }))
  expect(await screen.findByText('本次所选')).toBeVisible()
  expect(screen.getAllByText('数值越大，正则约束越弱。').length).toBeGreaterThanOrEqual(2)
})

it('explains the method that the current data cannot train', async () => {
  const blocked = { ...choice('tabular-resnet-v1', '表格残差网络', 'deep'), available: false, reason: '缺少依赖：torch' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/training-methods')) {
      return Response.json({ schema: 'kamei14-git-v2', methods: [choice('decision-tree-v1', '决策树 · CART', 'classic'), blocked] })
    }
    if (path.includes('/split-preview')) return Response.json(SPLIT)
    if (path.includes('/user/datasets')) return Response.json({ datasets: [DATASET] })
    return Response.json({})
  })
  render(<TrainingCreateDialog open initialMethod="tabular-resnet-v1" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)

  expect(await screen.findByText('缺少依赖：torch')).toBeVisible()
  expect(screen.getByText('已选 0 / 4')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: /表格残差网络/ })).toBeDisabled()
})

it('prefers a repository-compatible dataset when opened for retraining', async () => {
  const old = { ...DATASET, version: 'kamei14-2013-old', dataset: 'old', schema: 'kamei14-2013-v1' }
  const methodPaths: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/training-methods')) {
      methodPaths.push(path)
      return Response.json(METHODS)
    }
    if (path.includes('/split-preview')) return Response.json(SPLIT)
    if (path.includes('/user/datasets')) return Response.json({ datasets: [old, DATASET] })
    return Response.json({})
  })
  render(<TrainingCreateDialog open preferredSchema="kamei14-git-v2" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)

  await waitFor(() => expect(methodPaths.some(path => path.includes('schema=kamei14-git-v2'))).toBe(true))
  expect(methodPaths.some(path => path.includes('schema=kamei14-2013-v1'))).toBe(false)
})

it('previews and submits the three custom split ratios', async () => {
  const calls: { path: string; options?: RequestInit }[] = []
  const created = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const path = String(input)
    calls.push({ path, options })
    if (path.includes('/training-methods')) return Response.json(METHODS)
    if (path.includes('/split-preview')) {
      return Response.json({
        ...SPLIT,
        preset: {
          kind: 'custom', id: 'temporal-custom-65-20-15',
          ratios: { train: 65, validation: 20, test: 15 }, timezone: 'UTC',
        },
        policy: {
          id: 'temporal-custom-65-20-15',
          ratios: { train: 65, validation: 20, test: 15 },
          timezone: 'UTC', memberSha256: 'c'.repeat(64),
        },
      })
    }
    if (path.includes('/user/datasets')) return Response.json({ datasets: [DATASET] })
    if (path.endsWith('/api/v1/user/training-experiments')) {
      return Response.json({
        experimentId: 'custom-exp', datasetVersion: DATASET.version,
        datasetManifest: 'demo.json', manifestSha256: 'a'.repeat(64),
        metricSet: 'metric-set-v2', splitPreset: 'temporal-custom-65-20-15',
        classPolicy: null, seed: 2026, requestId: null, createdBy: 'reader',
        ownerUserId: 'reader', createdAt: '2026-11-20T00:00:00Z',
        status: 'queued', statusCounts: { queued: 1 }, tasks: [],
      })
    }
    return Response.json({})
  })
  render(<TrainingCreateDialog open initialMethod="mlp-v1" onOpenChange={vi.fn()} onCreated={created}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '自定义比例' }))
  const train = screen.getByRole('spinbutton', { name: '训练比例' })
  await user.clear(train)
  await user.type(train, '65')
  const validation = screen.getByRole('spinbutton', { name: '验证比例' })
  await user.clear(validation)
  await user.type(validation, '20')
  await waitFor(() => expect(calls.some(call =>
    call.path.includes('split-preview?train=65&validation=20&test=15'))).toBe(true))
  expect(screen.getByText(/temporal-custom-65-20-15/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '开始训练（1 个方法）' }))
  await waitFor(() => expect(created).toHaveBeenCalled())
  const submit = calls.find(call => call.path.endsWith('/api/v1/user/training-experiments')
    && call.options?.method === 'POST')
  expect(JSON.parse(String(submit?.options?.body))).toMatchObject({
    splitRatios: { train: 65, validation: 20, test: 15 },
  })
  expect(JSON.parse(String(submit?.options?.body))).not.toHaveProperty('splitPreset')
})

it('blocks submission while custom ratios do not total 100', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => respond(input))
  render(<TrainingCreateDialog open initialMethod="mlp-v1" onOpenChange={vi.fn()} onCreated={vi.fn()}
    onLoginRequired={vi.fn()} onOpenData={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '自定义比例' }))
  const test = screen.getByRole('spinbutton', { name: '测试比例' })
  await user.clear(test)
  await user.type(test, '20')
  expect(screen.getByRole('alert')).toHaveTextContent('合计 105%')
  expect(screen.getByRole('button', { name: '开始训练（1 个方法）' })).toBeDisabled()
})
