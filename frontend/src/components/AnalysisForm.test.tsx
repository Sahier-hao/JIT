import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisForm } from './AnalysisForm'

afterEach(() => vi.restoreAllMocks())
it('shows a loading state while model metadata is pending without claiming the model is missing', () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}))
  render(<AnalysisForm repositoryUrl="https://github.com/example/pending" initial={{ modelId: 'saved-model' }} onStarted={vi.fn()}/>);
  expect(screen.getByText(/正在读取模型设置/)).toBeVisible()
  expect(screen.queryByText(/尚未设置默认模型/)).not.toBeInTheDocument()
  expect(screen.queryByText(/原选模型已停用或不可用/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
})

it('explains the administrator default and blocks a saved disabled selection until corrected', async () => {
  sessionStorage.clear()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ models: [
    { modelId: 'lr', name: '逻辑回归', method: 'lr', state: 'ready', enabled: true, isDefault: true, repositoryPredictionSupported: true },
    { modelId: 'dt', name: '决策树', method: 'dt', state: 'ready', enabled: false, isDefault: false, repositoryPredictionSupported: false },
  ] }), { status: 200 }))
  render(<AnalysisForm repositoryUrl="https://github.com/example/policy" initial={{ modelId: 'dt', strategy: 'generic-model' }} onStarted={vi.fn()}/>);
  expect(await screen.findByText(/管理员默认模型：逻辑回归/)).toBeVisible()
  expect(await screen.findByText(/原选模型已停用或不可用/)).toBeVisible()
  expect(screen.getByRole('button', { name: '开始分析' })).toBeDisabled()
  expect(fetch.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true)
  await userEvent.setup().selectOptions(screen.getByLabelText('模型来源'), 'auto')
  expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled()
})

it('offers real registered models and sends the explicitly selected model', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') return new Response('{}', { status: 422 })
    return new Response(JSON.stringify({ models: [
      { modelId: 'lr', name: '逻辑回归', method: 'logistic-regression-l2-v1', state: 'ready', repositoryPredictionSupported: true },
      { modelId: 'dt', name: '决策树', method: 'decision-tree-v1', state: 'ready', repositoryPredictionSupported: true },
    ] }), { status: 200 })
  })
  render(<AnalysisForm repositoryUrl="https://github.com/example/repo" onStarted={vi.fn()}/>); const user = userEvent.setup()
  await user.selectOptions(await screen.findByLabelText('模型来源'), 'dt')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  const call = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ modelId: 'dt', strategy: 'generic-model' })
})
