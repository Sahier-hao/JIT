import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyDataPage } from './MyDataPage'
import { MyModelsPage } from './MyModelsPage'
import { UserAccount } from '../components/UserAccount'

afterEach(() => vi.restoreAllMocks())

const DATASET = {
  version: 'kamei14-git-v2-demo-2026-01-01_2026-10-01', dataset: 'demo', schema: 'kamei14-git-v2',
  timeRange: { start: '2026-01-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
  quality: { rawRows: 20, includedRows: 18, positiveLabels: 5 },
  file: { name: 'demo.csv', sha256: 'a'.repeat(64), bytes: 100 },
  source: { url: 'https://github.com/example/demo' }, labelRule: 'szz-full-v1', limitations: [],
  mine: true, shared: false,
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

it('registers a user from the account dialog and enters my data', async () => {
  const navigate = vi.fn()
  const onChange = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    if (String(input).endsWith('/api/user/register') && options?.method === 'POST') {
      return Response.json({ authenticated: true, username: 'reader' })
    }
    return Response.json({ authenticated: false, username: null })
  })
  render(<UserAccount session={null} onChange={onChange} navigate={navigate}/>)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '登录 / 注册' }))
  await user.click(screen.getByRole('radio', { name: '注册' }))
  await user.type(screen.getByLabelText('用户账户名'), 'reader')
  await user.type(screen.getByLabelText('用户密码'), 'reader-pass-1')
  await user.click(screen.getByRole('button', { name: '注册并进入' }))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ authenticated: true, username: 'reader' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-data' })
})

it('shows own data, split preview and starts a user experiment', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET] })
    if (value.includes('/training-methods')) return Response.json(METHODS)
    if (value.includes('/split-preview')) return Response.json(SPLIT)
    if (value.endsWith('/api/v1/user/training-experiments') && options?.method === 'POST') {
      return Response.json({ experimentId: 'e1', datasetVersion: DATASET.version, datasetManifest: 'm', manifestSha256: 'b'.repeat(64), metricSet: 'metric-set-v2', splitPreset: 'temporal-70-15-15', classPolicy: null, seed: 2026, requestId: null, createdBy: 'reader', createdAt: '2026-11-09T00:00:00Z', status: 'queued', statusCounts: {}, tasks: [] })
    }
    return Response.json({})
  })
  render(<MyDataPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText('demo')).toBeVisible()
  expect(await screen.findByText(/12 行 · 3 正例/)).toBeVisible()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('checkbox', { name: /逻辑回归/ }))
  await user.click(screen.getByRole('button', { name: '开始训练（1 个方法）' }))
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
