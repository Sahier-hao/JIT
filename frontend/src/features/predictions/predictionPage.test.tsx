import { fireEvent, render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyPredictionsPage } from '@/features/predictions/pages/MyPredictionsPage'

afterEach(() => vi.restoreAllMocks())

const DATASET = {
  version: 'demo-v1', dataset: 'demo', schema: 'openstack-six-v1',
  timeRange: { start: '2026-01-01', end: '2026-10-01' },
  quality: { rawRows: 20, includedRows: 18, positiveLabels: 5, excluded: {} },
  file: { name: 'demo.csv', sha256: 'a'.repeat(64), bytes: 100 },
  source: {}, fieldCount: 6, fieldNames: [], featureFields: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'],
  labelRule: null, labelMaturity: null, labelObservations: null, limitations: [], curation: null,
  integrity: {}, mine: true, shared: false, usage: 'import',
  timestamps: { registeredAt: null, importedAt: null, ownedAt: null, builtAt: null },
}
const MODEL = {
  modelId: '11111111-1111-4111-8111-111111111111', name: '逻辑回归 · 六字段',
  method: 'logistic-regression-l2-v1', runId: 'run-demo', featureSchemaVersion: 'openstack-six-v1',
  artifactDatasetVersion: 'demo-v1', isDefault: true,
}
const thresholds = () => Array.from({ length: 101 }, (_, index) => index / 100)
const BATCH = {
  batchId: '22222222-2222-4222-8222-222222222222', datasetVersion: DATASET.version,
  dataset: DATASET.dataset, model: MODEL, threshold: 0.5,
  counts: { records: 18, positives: 5, negatives: 13, flagged: 6 },
  labelStatusCounts: { positive: 5, unknown: 13 },
  thresholdPreview: {
    thresholds: thresholds(), positives: 5, negatives: 13,
    truePositives: Array.from({ length: 101 }, (_, index) => Math.max(0, 5 - Math.floor(index / 21))),
    falsePositives: Array.from({ length: 101 }, (_, index) => Math.max(0, 13 - Math.floor(index / 8))),
  },
  explanationCoverage: { method: 'occlusion-mean-v1', limit: 10, recorded: 1, failed: 0 },
  featureNames: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'], createdAt: '2026-11-21T00:00:00Z',
  limitations: ['风险是提交级模型估计，不是缺陷概率，也不提供行级定位。'],
}
const DETAIL = {
  ...BATCH,
  records: [{
    predictionId: 'p1', recordId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    authorTime: '2026-10-01T00:00:00Z', label: 1, labelStatus: 'positive', risk: 0.82,
    features: { ns: 1, nd: 2, nf: 3, ent: 0.8, la: 10, ld: 2 },
    explanation: {
      status: 'supported', method: 'occlusion-mean-v1',
      summary: '本次预测风险为 0.820，影响最大的是 la（推高 0.120）。',
      items: [{ feature: 'la', value: 10, baseline: 3, delta: 0.12, direction: 'increases' }],
    },
  }],
  limit: 100, offset: 0, sort: 'risk',
}

it('creates a fixed dataset/model prediction and opens its result', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const value = String(input)
    if (value.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET], limit: 12 })
    if (value.includes('/api/v1/user/prediction-batches?limit=')) return Response.json({ batches: [] })
    if (value.includes('/api/v1/user/prediction-models?')) return Response.json({ models: [MODEL], maxRecords: 20_000 })
    if (value.endsWith('/api/v1/user/prediction-batches') && options?.method === 'POST') return Response.json(BATCH)
    return Response.json({})
  })
  render(<MyPredictionsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  const submit = await screen.findByRole('button', { name: '开始试算' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-predictions', batchId: BATCH.batchId }))
})

it('reopens saved thresholds, metrics and top-risk attribution', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(DETAIL))
  render(<MyPredictionsPage batchId={BATCH.batchId} navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible()
  expect(screen.getByText('高风险提交')).toBeVisible()
  expect(screen.getByText(/影响最大的是 la/)).toBeVisible()
  const slider = screen.getByRole('slider', { name: '风险分数阈值' })
  fireEvent.change(slider, { target: { value: '80' } })
  expect(screen.getAllByText('0.80').length).toBeGreaterThan(0)
  const metric = screen.getByRole('button', { name: /召回率/ })
  await user.click(metric)
  expect(within(screen.getByRole('button', { name: /召回率/ })).getByText(/%/)).toBeVisible()
})
