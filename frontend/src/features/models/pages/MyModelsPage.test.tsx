import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { response } from '@/features/projects/projectActivity.fixture'
import { MyModelsPage } from '@/features/models/pages/MyModelsPage'

afterEach(() => vi.restoreAllMocks())

it('marks model purpose and offers v2 retraining for legacy models', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).endsWith('/api/v1/user/models')) return response({ models: [
      { modelId: 'v2-model', name: 'Wide&Deep · v2', method: 'wide-deep-v1', featureSchemaVersion: 'kamei14-git-v2',
        state: 'ready', enabled: true, parameters: null, datasetVersion: 'repo-v2', mine: true, shared: false },
      { modelId: 'v1-model', name: 'Wide&Deep · v1', method: 'wide-deep-v1', featureSchemaVersion: 'kamei14-git-v1',
        state: 'ready', enabled: true, parameters: null, datasetVersion: 'old-v1', mine: true, shared: false },
    ] })
    return response({})
  })
  const navigate = vi.fn()
  render(<MyModelsPage navigate={navigate} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText('可用于仓库分析')).toBeVisible()
  expect(screen.getByText('不可用于仓库分析')).toBeVisible()
  expect(screen.getByText(/旧版 kamei14-git-v1 口径/)).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '用 v2 口径重训' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-training', schema: 'kamei14-git-v2' })
})
