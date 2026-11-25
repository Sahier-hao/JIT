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
