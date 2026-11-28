import { fireEvent, render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyPredictionsPage } from '@/features/predictions/pages/MyPredictionsPage'
import { MyEvaluationPage } from '@/features/predictions/pages/MyEvaluationPage'

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
  artifactDatasetVersion: 'demo-v1',
  featureNames: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'],
  isDefault: true, mine: true, shared: false,
}
const thresholds = () => Array.from({ length: 101 }, (_, index) => index / 100)
const BATCH = {
  batchId: '22222222-2222-4222-8222-222222222222', mode: 'batch',
  sourceKind: 'dataset', source: { kind: 'dataset', label: '数据版本', reference: {} },
  datasetVersion: DATASET.version, dataset: DATASET.dataset, model: MODEL, threshold: 0.5,
  splitPreset: null, partition: null, memberSha256: 'f'.repeat(64),
  counts: { records: 18, labeledAvailable: 18, unavailable: 0, positives: 5, negatives: 13, flagged: 6 },
  labelStatusCounts: { positive: 5, unobserved: 13 },
  labelAvailabilityCounts: { available: 18, unavailable: 0 },
  thresholdPreview: {
    thresholds: thresholds(), positives: 5, negatives: 13,
    truePositives: Array.from({ length: 101 }, (_, index) => Math.max(0, 5 - Math.floor(index / 21))),
    falsePositives: Array.from({ length: 101 }, (_, index) => Math.max(0, 13 - Math.floor(index / 8))),
  },
  evaluationEligible: true, evaluationReason: '包含可用真实标签，可进入评估',
  explanationCoverage: { method: 'occlusion-mean-v1', limit: 10, recorded: 1, failed: 0 },
  featureNames: ['ns', 'nd', 'nf', 'ent', 'la', 'ld'], createdAt: '2026-11-21T00:00:00Z',
  limitations: ['预测分数是提交级模型估计，不是缺陷概率。'],
}
const RECORD = {
  predictionId: 'p1', recordId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  authorTime: '2026-10-01T00:00:00Z', label: 1, labelStatus: 'positive',
  labelAvailability: 'available', sourceKind: 'dataset', sourceRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  risk: 0.82, features: { ns: 1, nd: 2, nf: 3, ent: 0.8, la: 10, ld: 2 },
  explanation: {
    status: 'supported', method: 'occlusion-mean-v1',
    summary: '本次预测风险为 0.820，影响最大的是 la（推高 0.120）。',
    items: [{ feature: 'la', value: 10, baseline: 3, delta: 0.12, direction: 'increases' }],
  },
}
const DETAIL = {
  ...BATCH,
  records: [RECORD],
  limit: 50, offset: 0, sort: 'risk', search: null,
}
const SAMPLE = {
  recordId: RECORD.recordId, authorTime: RECORD.authorTime, label: 1,
  labelStatus: 'positive', labelAvailability: 'available',
  features: RECORD.features, sourceKind: 'dataset',
}
const SPLITS = {
  datasetVersion: DATASET.version, modelId: MODEL.modelId, featureSchemaVersion: DATASET.schema,
  full: { count: 18, memberSha256: 'e'.repeat(64) },
  modelSplit: {
    source: 'model', modelId: MODEL.modelId, splitPreset: 'temporal-70-15-15', memberSha256: 'd'.repeat(64),
    partitions: {
      train: { count: 10, positives: 3, start: '2026-01-01', end: '2026-06-01' },
      validation: { count: 4, positives: 1, start: '2026-06-02', end: '2026-08-01' },
      test: { count: 4, positives: 1, start: '2026-08-02', end: '2026-10-01' },
    },
  },
  presets: [{
    id: 'temporal-70-15-15', available: true, reason: null,
    ratios: { train: 70, validation: 15, test: 15 }, memberSha256: 'd'.repeat(64),
    partitions: {
      train: { count: 10, positives: 3, start: '2026-01-01', end: '2026-06-01' },
      validation: { count: 4, positives: 1, start: '2026-06-02', end: '2026-08-01' },
      test: { count: 4, positives: 1, start: '2026-08-02', end: '2026-10-01' },
    },
  }],
}

function installPageFetch(overrides: (url: string, options?: RequestInit) => Response | null = () => null) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = String(input)
    const custom = overrides(url, options)
    if (custom) return custom
    if (url.includes('/api/v1/user/datasets?scope=')) return Response.json({ datasets: [DATASET], limit: 12 })
    if (url.includes('/api/v1/user/prediction-batches?limit=')) return Response.json({ batches: [BATCH] })
    if (url.includes('/api/v1/user/prediction-models')) return Response.json({ models: [MODEL], maxRecords: 20_000 })
    if (url.includes('/api/v1/user/prediction-samples?')) return Response.json({
      datasetVersion: DATASET.version, dataset: DATASET.dataset, schema: DATASET.schema,
      total: 1, limit: 10, offset: 0, search: null, samples: [SAMPLE],
    })
    if (url.includes('/api/v1/user/prediction-splits?')) return Response.json(SPLITS)
    if (url.includes(`/api/v1/user/prediction-batches/${BATCH.batchId}?`)) return Response.json(DETAIL)
    if (url.endsWith('/api/v1/user/prediction-batches') && options?.method === 'POST') return Response.json(BATCH)
    if (url.endsWith('/api/v1/user/prediction-batches/single') && options?.method === 'POST') {
      return Response.json({ ...BATCH, mode: 'single' })
    }
    if (url.includes('/api/v1/user/prediction-batches/unlabeled?') && options?.method === 'POST') {
      return Response.json({ ...BATCH, sourceKind: 'unlabeled-csv' })
    }
    throw new Error(`未处理的请求：${url}`)
  })
}

it('creates a fixed dataset/model batch prediction and opens its result', async () => {
  const navigate = vi.fn()
  const fetch = installPageFetch()
  render(<MyPredictionsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  const submit = await screen.findByRole('button', { name: '开始批量预测' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-predictions', batchId: BATCH.batchId }))
  const post = fetch.mock.calls.find(([url, options]) => String(url).endsWith('/api/v1/user/prediction-batches') && options?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    datasetVersion: DATASET.version, modelId: MODEL.modelId, threshold: 0.5,
  })
})

it('creates a frozen preset partition batch with member identity', async () => {
  const navigate = vi.fn()
  const fetch = installPageFetch()
  render(<MyPredictionsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('combobox', { name: '评分范围' })).toBeEnabled())
  await user.selectOptions(screen.getByRole('combobox', { name: '评分范围' }), 'frozen')
  await screen.findByText(/测试集 4 条/)
  await user.selectOptions(screen.getByRole('combobox', { name: '分区来源' }), 'preset')
  await user.selectOptions(screen.getByRole('combobox', { name: '预测分区' }), 'test')
  await user.click(screen.getByRole('button', { name: '开始批量预测' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-predictions', batchId: BATCH.batchId }))
  const post = fetch.mock.calls.find(([url, options]) => String(url).endsWith('/api/v1/user/prediction-batches') && options?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    partition: 'test', splitSource: 'preset', splitPreset: 'temporal-70-15-15',
  })
})

it('selects a dataset row for single prediction using the same model contract', async () => {
  const navigate = vi.fn()
  const fetch = installPageFetch()
  render(<MyPredictionsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('tab', { name: '单条预测' }))
  await user.click(await screen.findByRole('button', { name: '选用' }))
  const submit = screen.getByRole('button', { name: '开始单条预测' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-predictions', batchId: BATCH.batchId }))
  const post = fetch.mock.calls.find(([url]) => String(url).endsWith('/api/v1/user/prediction-batches/single'))
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    modelId: MODEL.modelId,
    source: { kind: 'dataset', datasetVersion: DATASET.version, recordId: SAMPLE.recordId },
  })
})

it('uploads an unlabeled CSV without manufacturing labels', async () => {
  const navigate = vi.fn()
  const fetch = installPageFetch()
  render(<MyPredictionsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await waitFor(() => expect(screen.getByRole('combobox', { name: '批量来源' })).toBeVisible())
  await user.selectOptions(screen.getByRole('combobox', { name: '批量来源' }), 'csv')
  const file = new File(['ns,nd,nf,ent,la,ld\n1,2,3,0.8,10,2\n'], 'unlabeled.csv', { type: 'text/csv' })
  await user.upload(screen.getByLabelText('无标签 CSV'), file)
  const submit = screen.getByRole('button', { name: '开始批量预测' })
  await waitFor(() => expect(submit).toBeEnabled())
  await user.click(submit)
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'my-predictions', batchId: BATCH.batchId }))
  const post = fetch.mock.calls.find(([url]) => String(url).includes('/prediction-batches/unlabeled?'))
  if (!post) throw new Error('未提交无标签 CSV')
  const body = post[1]?.body
  expect(body).toBeInstanceOf(File)
  expect((body as File).name).toBe('unlabeled.csv')
})

it('reopens saved results, recalculates threshold labels and hands off to evaluation', async () => {
  const navigate = vi.fn()
  const fetch = installPageFetch()
  render(<MyPredictionsPage batchId={BATCH.batchId} navigate={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible()
  expect(screen.getByText('达到阈值')).toBeVisible()
  expect(screen.getByText(/已确认正例/)).toBeVisible()
  fireEvent.keyDown(screen.getByRole('slider', { name: '分类阈值' }), { key: 'End' })
  expect(screen.getByText('未达到阈值')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '去评估' }))
  expect(navigate).toHaveBeenCalledWith({
    name: 'my-evaluation',
    batchId: BATCH.batchId,
    modelId: MODEL.modelId,
    datasetVersion: DATASET.version,
  })
  expect(screen.getByRole('link', { name: /导出 CSV/ })).toHaveAttribute('download')
  await user.click(screen.getByRole('button', { name: '查看归因' }))
  expect(await screen.findByText(/影响最大的是 la/)).toBeVisible()
  expect(fetch.mock.calls.every(([url, options]) => options?.method !== 'POST' && !String(url).includes('/single'))).toBe(true)
})

it('does not offer evaluation for an unlabeled result', async () => {
  const unlabeled = {
    ...DETAIL,
    evaluationEligible: false,
    evaluationReason: '所有记录均无可用真实标签，不进入评估',
    counts: { ...DETAIL.counts, labeledAvailable: 0, unavailable: 1, positives: 0, negatives: 0, flagged: 1 },
    labelAvailabilityCounts: { available: 0, unavailable: 1 },
    labelStatusCounts: { unavailable: 1 },
    records: [{ ...RECORD, label: null, labelStatus: 'unavailable', labelAvailability: 'unavailable' }],
  }
  installPageFetch((url) => url.includes(`/prediction-batches/${BATCH.batchId}?`) ? Response.json(unlabeled) : null)
  render(<MyPredictionsPage batchId={BATCH.batchId} navigate={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText(/所有记录均无可用真实标签/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '去评估' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /导出 CSV/ })).toBeVisible()
  expect(screen.getAllByText(/无标签/).length).toBeGreaterThan(0)
})

const EVALUATION = {
  format: 'user-prediction-evaluation-v1', batchId: BATCH.batchId, mode: 'batch',
  model: MODEL, datasetVersion: DATASET.version, dataset: DATASET.dataset,
  source: BATCH.source, sourceKind: 'dataset', splitPreset: 'temporal-70-15-15',
  partition: 'test', memberSha256: 'd'.repeat(64), threshold: 0.5, eligible: true,
  reason: '包含可用真实标签，可进入评估',
  counts: BATCH.counts, labelStatusCounts: BATCH.labelStatusCounts,
  labelAvailabilityCounts: BATCH.labelAvailabilityCounts,
  thresholdPreview: BATCH.thresholdPreview,
  confusion: { tp: 4, fp: 3, tn: 10, fn: 1 },
  precision: 4 / 7, recall: 4 / 5, f1: 2 * (4 / 7) * (4 / 5) / ((4 / 7) + (4 / 5)),
  limitations: ['评估只使用成熟且可用的真实标签。'],
}

it('reopens the evaluation handoff with model, data, partition and threshold metrics', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes(`/prediction-batches/${BATCH.batchId}/evaluation`)) return Response.json(EVALUATION)
    throw new Error(`未处理的请求：${url}`)
  })
  render(<MyEvaluationPage
    route={{ name: 'my-evaluation', batchId: BATCH.batchId, modelId: MODEL.modelId, datasetVersion: DATASET.version, partition: 'test', splitPreset: 'temporal-70-15-15' }}
    navigate={vi.fn()}
    onLoginRequired={vi.fn()}
  />)
  expect(await screen.findByRole('heading', { name: 'demo' })).toBeVisible()
  expect(screen.getByText('逻辑回归 · 六字段')).toBeVisible()
  expect(screen.getAllByText(/测试集/).length).toBeGreaterThan(0)
  expect(screen.getByRole('table', { name: '混淆矩阵' })).toBeVisible()
  expect(within(screen.getByRole('table', { name: '混淆矩阵' })).getByText('3')).toBeVisible()
  expect(screen.getByText(/只重算已保存分数/)).toBeVisible()
})

it('rejects an evaluation address whose model is not the batch model', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(EVALUATION))
  render(<MyEvaluationPage
    route={{ name: 'my-evaluation', batchId: BATCH.batchId, modelId: 'other-model' }}
    navigate={vi.fn()}
    onLoginRequired={vi.fn()}
  />)
  expect(await screen.findByText(/模型与预测批次不一致/)).toBeVisible()
})
