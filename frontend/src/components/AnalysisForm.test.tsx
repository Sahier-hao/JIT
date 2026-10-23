import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisForm } from './AnalysisForm'

afterEach(() => vi.restoreAllMocks())
it('offers real registered models and sends the explicitly selected model', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') return new Response('{}', { status: 422 })
    return new Response(JSON.stringify({ models: [
      { modelId: 'lr', name: '逻辑回归', method: 'logistic-regression-l2-v1', state: 'ready', repositoryPredictionSupported: true },
      { modelId: 'dt', name: '决策树', method: 'decision-tree-v1', state: 'ready', repositoryPredictionSupported: true },
    ] }), { status: 200 })
  })
  render(<AnalysisForm repositoryUrl="https://github.com/example/repo" onStarted={vi.fn()}/>); const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /分析选项/ }))
  await user.selectOptions(await screen.findByLabelText('分析模型'), 'dt')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true))
  const call = fetch.mock.calls.find(([, options]) => options?.method === 'POST')!
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({ modelId: 'dt', strategy: 'generic-model' })
})
