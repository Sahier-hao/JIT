import { render, screen, waitFor, within } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'

afterEach(() => vi.restoreAllMocks())
const READINESS = {
  ready: true, completeArtifacts: 2, unregisteredExperiments: 0, registeredModels: 2,
  readyModels: 2, repositorySelectableModels: 2, defaultModelId: 'lr',
  defaultAvailable: true, reportOnlyArtifacts: 0, issues: [],
}
it('switches default before allowing disable, confirms impact and refreshes saved policy', async () => {
  let models = [
    { modelId: 'lr', name: '逻辑回归', state: 'ready', featureSchemaVersion: 'openstack-six-v1', enabled: true, isDefault: true },
    { modelId: 'dt', name: '决策树', state: 'ready', featureSchemaVersion: 'openstack-six-v1', enabled: true, isDefault: false },
  ]
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/session')) return Response.json({ authenticated: true, username: 'admin' })
    if (options?.method === 'PATCH') {
      const id = String(path).split('/').at(-2)
      const changes = JSON.parse(String(options.body))
      models = models.map(model => ({ ...model, ...(changes.isDefault ? { isDefault: model.modelId === id } : {}), ...(model.modelId === id ? changes : {}) }))
      return Response.json(models.find(model => model.modelId === id))
    }
    return Response.json(String(path).endsWith('/models') ? { models, methods: [], readiness: READINESS } : { candidates: [] })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={vi.fn()}/>);
  const user = userEvent.setup()
  const first = (await screen.findByRole('heading', { name: '逻辑回归' })).closest('article')!
  const second = screen.getByRole('heading', { name: '决策树' }).closest('article')!
  expect(within(first).getByRole('button', { name: '停用模型' })).toBeDisabled()
  await user.click(within(second).getByRole('button', { name: '设为默认' }))
  await waitFor(() => expect(within(first).getByRole('button', { name: '停用模型' })).toBeEnabled())
  await user.click(within(first).getByRole('button', { name: '停用模型' }))
  expect(screen.getByText(/已完成结果保留/)).toBeVisible()
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  await user.click(within(first).getByRole('button', { name: '停用模型' }))
  await user.click(screen.getByRole('button', { name: '确认停用' }))
  await waitFor(() => expect(within(first).getByRole('button', { name: '启用模型' })).toBeVisible())
  expect(models[0].enabled).toBe(false)
  await user.click(within(first).getByRole('button', { name: '启用模型' }))
  await waitFor(() => expect(within(first).getByRole('button', { name: '停用模型' })).toBeVisible())
})

it('keeps the saved policy and a recovery message when a write is rejected', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/session')) return Response.json({ authenticated: true, username: 'admin' })
    if (options?.method === 'PATCH') return Response.json({ error: { code: 'DEFAULT_MODEL_REQUIRED', message: '默认已变化，请刷新后重试', requestId: 'test' } }, { status: 409 })
    return Response.json(String(path).endsWith('/models') ? { models: [{ modelId: 'dt', name: '决策树', state: 'ready', featureSchemaVersion: 'openstack-six-v1', enabled: true, isDefault: false }], methods: [], readiness: { ...READINESS, defaultModelId: 'dt' } } : { candidates: [] })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={vi.fn()}/>);
  await userEvent.setup().click(await screen.findByRole('button', { name: '设为默认' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('默认已变化，请刷新后重试')
  expect(screen.queryByText('默认模型', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled()
})

it('shows unregistered experiment readiness without counting them as models', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/session')) return Response.json({ authenticated: true, username: 'admin' })
    if (String(path).endsWith('/model-candidates')) return Response.json({ candidates: [] })
    return Response.json({
      models: [],
      methods: [],
      readiness: {
        ready: false, completeArtifacts: 9, unregisteredExperiments: 9, registeredModels: 0,
        readyModels: 0, repositorySelectableModels: 0, defaultModelId: null,
        defaultAvailable: false, reportOnlyArtifacts: 1,
        issues: [
          { code: 'UNREGISTERED_EXPERIMENTS', message: '9 个完整实验运行尚未登记。' },
          { code: 'NO_READY_MODELS', message: '模型目录没有可用模型，用户不能选择模型。' },
        ],
      },
    })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={navigate}/>)
  expect(await screen.findByLabelText('模型目录就绪状态')).toBeVisible()
  expect(screen.getByText('9 个完整实验运行尚未登记。')).toBeVisible()
  expect(screen.getByText('0 个可用模型')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '查看未登记实验' }))
  expect(navigate).toHaveBeenCalledWith({
    name: 'admin', view: 'experiments', registrationState: 'unregistered', artifactState: 'complete',
  })
})
