import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from '@/features/admin/AdminWorkspace'

afterEach(() => vi.restoreAllMocks())
const READINESS = {
  ready: true, completeArtifacts: 2, unregisteredExperiments: 0, registeredModels: 2,
  readyModels: 2, repositorySelectableModels: 2, defaultModelId: 'lr',
  defaultAvailable: true, reportOnlyArtifacts: 0, issues: [],
}

it('searches the model directory and scopes policy actions to the visible selection', async () => {
  const models = [
    { modelId: 'lr', name: '逻辑回归', method: 'logistic-regression-l2-v1', state: 'ready', featureSchemaVersion: 'openstack-six-v1', enabled: true, isDefault: true },
    { modelId: 'tree', name: '决策树', method: 'decision-tree-v1', state: 'invalid', featureSchemaVersion: 'kamei14-git-v2', enabled: true, isDefault: false },
  ]
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/session')) return Response.json({ authenticated: true, username: 'admin' })
    if (String(path).endsWith('/models?view=registered')) return Response.json({ models })
    return Response.json({})
  })
  const user = userEvent.setup()
  const navigate = vi.fn()
  const route = { name: 'admin', view: 'models' } as const
  const { rerender } = render(<AdminWorkspace route={route} navigate={navigate}/>)
  const search = await screen.findByRole('textbox', { name: '搜索模型' })
  const directory = within(screen.getByRole('navigation', { name: '模型列表' }))
  const detail = within(screen.getByRole('region', { name: '选中模型' }))
  expect(detail.getByRole('heading', { name: '逻辑回归' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '查看详情' })).toHaveLength(1)
  await user.type(search, 'decision-tree-v1')
  expect(directory.queryByRole('link', { name: /逻辑回归/ })).not.toBeInTheDocument()
  await user.click(directory.getByRole('link', { name: /决策树/ }))
  expect(navigate).toHaveBeenCalledWith({ ...route, selectedModelId: 'tree' })
  rerender(<AdminWorkspace route={{ ...route, selectedModelId: 'tree' }} navigate={navigate}/>)
  expect(detail.getByRole('heading', { name: '决策树' })).toBeVisible()
  expect(detail.getByRole('button', { name: '设为默认' })).toBeDisabled()
  expect(fetch.mock.calls.some(([path]) => /view=diagnostics|models\/coverage|models\/tree$/.test(String(path)))).toBe(false)
  await user.clear(search)
  await user.selectOptions(screen.getByRole('combobox', { name: '模型状态' }), 'unavailable')
  expect(directory.queryByRole('link', { name: /逻辑回归/ })).not.toBeInTheDocument()
  expect(directory.getByRole('link', { name: /决策树/ })).toHaveAttribute('aria-current', 'page')
})

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
    return Response.json(String(path).endsWith('/models?view=registered') ? { models, methods: [], readiness: READINESS } : { candidates: [] })
  })
  const navigate = vi.fn()
  const route = { name: 'admin', view: 'models' } as const
  const { rerender } = render(<AdminWorkspace route={route} navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '逻辑回归' })
  const detail = within(screen.getByRole('region', { name: '选中模型' }))
  expect(detail.getByRole('button', { name: '停用模型' })).toBeDisabled()
  await user.click(screen.getByRole('link', { name: /决策树/ }))
  rerender(<AdminWorkspace route={{ ...route, selectedModelId: 'dt' }} navigate={navigate}/>)
  await user.click(detail.getByRole('button', { name: '设为默认' }))
  expect(await detail.findByText('默认模型', { exact: true })).toBeVisible()
  expect(detail.getByRole('button', { name: '停用模型' })).toBeDisabled()
  await user.click(screen.getByRole('link', { name: /逻辑回归/ }))
  rerender(<AdminWorkspace route={{ ...route, selectedModelId: 'lr' }} navigate={navigate}/>)
  expect(detail.getByRole('button', { name: '停用模型' })).toBeEnabled()
  await user.click(detail.getByRole('button', { name: '停用模型' }))
  expect(screen.getByText(/已完成结果保留/)).toBeVisible()
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(fetch.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1)
  await user.click(detail.getByRole('button', { name: '停用模型' }))
  await user.click(screen.getByRole('button', { name: '确认停用' }))
  await waitFor(() => expect(detail.getByRole('button', { name: '启用模型' })).toBeVisible())
  expect(models[0].enabled).toBe(false)
  await user.click(detail.getByRole('button', { name: '启用模型' }))
  await waitFor(() => expect(detail.getByRole('button', { name: '停用模型' })).toBeVisible())
})

it('keeps the saved policy and a recovery message when a write is rejected', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/session')) return Response.json({ authenticated: true, username: 'admin' })
    if (options?.method === 'PATCH') return Response.json({ error: { code: 'DEFAULT_MODEL_REQUIRED', message: '默认已变化，请刷新后重试', requestId: 'test' } }, { status: 409 })
    return Response.json(String(path).endsWith('/models?view=registered') ? { models: [{ modelId: 'dt', name: '决策树', state: 'ready', featureSchemaVersion: 'openstack-six-v1', enabled: true, isDefault: false }], methods: [], readiness: { ...READINESS, defaultModelId: 'dt' } } : { candidates: [] })
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
    return Response.json({
      models: [],
      methods: [],
      candidates: [],
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
  await userEvent.click(await screen.findByRole('button', { name: '查看产物诊断' }))
  expect(await screen.findByLabelText('模型目录就绪状态')).toBeVisible()
  expect(screen.getByText('9 个完整实验运行尚未登记。')).toBeVisible()
  expect(screen.getByText('0 个可用模型')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '查看未登记实验' }))
  expect(navigate).toHaveBeenCalledWith({
    name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', artifactState: 'complete',
  })
})
