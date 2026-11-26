import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisForm } from '@/features/projects/components/AnalysisForm'

afterEach(() => vi.restoreAllMocks())

function model(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return { modelId: id, name, method: 'lr', state: 'ready', enabled: true, isDefault: false, mine: true, shared: false, repositoryPredictionSupported: true, ...overrides }
}

it('shows a loading state while model metadata is pending without claiming the model is missing', () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))
  render(<AnalysisForm repositoryUrl="https://github.com/example/pending" initial={{ modelId: 'saved-model' }} onStarted={vi.fn()}/>)
  expect(screen.getByRole('combobox', { name: '模型来源' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: '模型来源' })).toHaveTextContent('正在核对原选模型')
  expect(screen.queryByText(/原选模型已停用、未开放或不可用/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
})

it('keeps a saved disabled selection visible and blocks until corrected', async () => {
  sessionStorage.clear()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [
    model('lr', '逻辑回归', { isDefault: true }),
    model('dt', '决策树', { enabled: false }),
  ] }), { status: 200 }))
  render(<AnalysisForm repositoryUrl="https://github.com/example/policy" initial={{ modelId: 'dt' }} onStarted={vi.fn()}/>)
  const user = userEvent.setup()
  const select = await screen.findByRole('combobox', { name: '模型来源' })
  expect(select).toHaveTextContent(/原选模型/)
  expect(await screen.findByText(/原选模型已停用、未开放或不可用/)).toBeVisible()
  expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
  expect(fetch.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: '逻辑回归 · 默认' }))
  expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled()
})

it('offers real registered models and sends the explicitly selected model', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') return new Response('{}', { status: 422 })
    return new Response(JSON.stringify({ models: [
      model('lr', '逻辑回归', { method: 'logistic-regression-l2-v1' }),
      model('dt', '决策树', { method: 'decision-tree-v1' }),
    ] }), { status: 200 })
  })
  render(<AnalysisForm repositoryUrl="https://github.com/example/repo" onStarted={vi.fn()}/>); const user = userEvent.setup()
  const select = await screen.findByRole('combobox', { name: '模型来源' })
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: '决策树' }))
  expect(screen.queryByLabelText('训练方法')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  const call = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ modelId: 'dt', strategy: 'generic-model' })
})

it('scores with the automatically selected default model and omits all training settings', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (options?.method === 'POST') return new Response('{}', { status: 202 })
    if (String(path).includes('/training-methods')) return new Response(JSON.stringify({
      schema: 'kamei14-git-v2',
      methods: [
        { method: 'decision-tree-v1', name: '决策树', label: '决策树', category: 'classic', available: true, supportedSchema: true, requires: [], reason: null },
      ],
    }), { status: 200 })
    return new Response(JSON.stringify({ models: [
      model('dt', '决策树', { isDefault: true, method: 'decision-tree-v1' }),
    ] }), { status: 200 })
  })
  render(<AnalysisForm repositoryUrl="https://github.com/example/default" onStarted={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByRole('combobox', { name: '模型来源' })).toHaveTextContent('决策树 · 默认')
  expect(screen.queryByLabelText('训练方法')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('时间切分预设')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('标签成熟策略')).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /自动.*训练|训练新模型/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  const call = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!
  const body = JSON.parse(String(call[1]?.body))
  expect(body).toEqual({ strategy: 'generic-model', repositoryUrl: 'https://github.com/example/default', modelId: 'dt' })
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/training-methods'))).toBe(false)
})

it('opens a read-only model card without changing the selected model or draft', async () => {
  sessionStorage.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).includes('/api/v1/model-cards/dt')) return Response.json({
      available: true, modelId: 'dt', name: '决策树', method: 'decision-tree-v1',
      featureSchemaVersion: 'kamei14-git-v1', datasetVersion: 'data-v1',
      metricSet: 'metric-set-v2', threshold: 0.5, splitRule: '时间切分',
      dataScale: { records: 30, featureWidth: 14 },
      trainingPerformance: { durationSeconds: 1.2, recordsPerSecond: 20 },
      source: { publisher: 'collected', revision: 'abc' },
      partitions: { train: { records: 20, positives: 3 }, validation: { records: 5, positives: 1 }, test: { records: 5, positives: 1 } },
      metricsByPartition: {
        train: { available: true, label: '拟合诊断', source: 'artifact', metrics: { averagePrecision: { value: 0.8, reason: null } } },
        validation: { available: true, label: '模型选择背景', source: 'artifact', metrics: { averagePrecision: { value: 0.6, reason: null } } },
        test: { available: true, label: '冻结泛化评价', source: 'artifact', metrics: { averagePrecision: { value: 0.5, reason: null } } },
      },
      benefit: { available: false, reason: '尚无收益报告' }, limitations: ['测试限制'],
    })
    if (String(path).includes('/api/v1/repository-models')) return Response.json({ models: [
      model('dt', '决策树', { method: 'decision-tree-v1' }),
    ] })
    return Response.json({ schema: 'kamei14-git-v2', methods: [] })
  })
  render(<AnalysisForm repositoryUrl="https://github.com/example/card" initial={{ branch: 'develop' }} onStarted={vi.fn()}/>)
  const user = userEvent.setup()
  const select = await screen.findByRole('combobox', { name: '模型来源' })
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: '决策树' }))
  await user.type(screen.getByLabelText('分支'), '-draft')
  await user.click(screen.getByRole('button', { name: '查看模型卡' }))
  const cardDialog = await screen.findByRole('dialog', { name: '模型卡' })
  expect(cardDialog).toBeVisible()
  expect(screen.getByRole('heading', { name: '拟合诊断' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '冻结泛化评价' })).toBeVisible()
  await user.click(within(cardDialog).getAllByRole('button', { name: '关闭' }).at(-1)!)
  expect(screen.getByRole('combobox', { name: '模型来源' })).toHaveTextContent('决策树')
  expect(screen.getByLabelText('分支')).toHaveValue('develop-draft')
})
