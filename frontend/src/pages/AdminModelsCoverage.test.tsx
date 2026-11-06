import { render, screen, waitFor, within } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'

afterEach(() => vi.restoreAllMocks())

const READINESS = {
  ready: true,
  completeArtifacts: 9,
  unregisteredExperiments: 8,
  completeUnregisteredExperiments: 8,
  invalidArtifacts: 0,
  registeredModels: 1,
  readyModels: 1,
  repositorySelectableModels: 1,
  userSelectableModels: 1,
  invalidModels: 0,
  artifactInvalidModels: 0,
  dependencyUnavailableModels: 0,
  disabledModels: 0,
  incompatibleModels: 0,
  defaultModelId: 'm1',
  defaultAvailable: true,
  reportOnlyArtifacts: 0,
  issues: [{ code: 'UNREGISTERED_EXPERIMENTS', message: '8 个完整实验运行尚未登记。' }],
}

const METHODS = [
  ['logistic-regression-l2-v1', '逻辑回归', 'registered-ready'],
  ['decision-tree-v1', '决策树', 'complete-unregistered'],
  ['random-forest-v1', '随机森林', 'invalid'],
  ['gradient-boosting-v1', '梯度提升', 'failed'],
  ['xgboost-v1', 'XGBoost', 'missing'],
  ['knn-v1', 'K 近邻', 'offline-only'],
  ['naive-bayes-v1', '朴素贝叶斯', 'input-unsupported'],
  ['neural-network-v1', '神经网络', 'incompatible'],
  ['deep-mlp-v1', '深度 MLP', 'registered-unavailable'],
] as const

function coverage() {
  return {
    datasets: [{
      datasetKey: 'dataset-key', dataset: '仓库 JIT 基准', datasetVersion: 'jit-v1',
      schema: 'kamei14-git-v1', metricSet: 'metric-set-v2', source: 'suite',
      suitePath: 'suites/jit', suiteStatus: 'partial',
      methods: METHODS.map(([method, name, state], index) => ({
        method, name, category: index > 5 ? 'deep' : 'classic', state,
        reason: state === 'failed' ? '训练未收敛' : state === 'invalid' ? '模型文件校验失败' : null,
        runId: state === 'missing' ? null : `run-${index}`,
        modelId: state === 'registered-ready' ? 'm1' : state === 'registered-unavailable' ? 'm9' : null,
        modelState: state.startsWith('registered') ? 'ready' : null,
        enabled: state === 'registered-ready' ? true : state === 'registered-unavailable' ? false : null,
        metrics: {},
      })),
      counts: Object.fromEntries(METHODS.map(([, , state]) => [state, 1])),
    }],
    total: 1,
    limit: 100,
    offset: 0,
    latestImport: {
      importId: '11111111-1111-4111-8111-111111111111',
      packageSha256: 'a'.repeat(64), packageVersion: 1, packageName: 'jit-models.zip',
      status: 'partial', modelCount: 9, registeredCount: 1, reusedCount: 0,
      alreadyRegisteredCount: 0, conflictCount: 1, failedCount: 0,
      code: null, message: null, createdAt: '2026-11-03T08:00:00Z',
      items: [{
        artifactRunId: 'b'.repeat(64), sourceModelId: null, artifactKey: 'conflict-model',
        status: 'conflict', modelId: null, runId: null, code: 'CONTEXT_MISMATCH',
        message: '目标位置已有不同运行',
      }],
    },
  }
}

function session(path: unknown) {
  return String(path).endsWith('/api/admin/session')
    ? Response.json({ authenticated: true, username: 'admin' }) : null
}

it('shows the nine-method coverage matrix and opens registered model details', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(path)
    if (auth) return auth
    const url = String(path)
    if (url.endsWith('/api/v1/model-candidates')) return Response.json({ candidates: [] })
    if (url.includes('/api/v1/models/coverage')) return Response.json(coverage())
    return Response.json({
      models: [{
        modelId: 'm1', name: '逻辑回归', method: 'logistic-regression-l2-v1',
        state: 'ready', enabled: true, isDefault: true, featureSchemaVersion: 'kamei14-git-v1',
        runId: 'run-1', artifactRunId: 'run-1', artifactDatasetVersion: 'jit-v1',
      }],
      methods: [],
      readiness: READINESS,
    })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={navigate}/>)

  const matrix = await screen.findByLabelText('数据集与方法训练覆盖')
  expect(within(matrix).getByText('仓库 JIT 基准')).toBeVisible()
  for (const [, name] of METHODS) expect(within(matrix).getByText(name)).toBeVisible()
  expect(within(matrix).getByText('训练未收敛')).toBeVisible()
  expect(within(matrix).getByText('模型文件校验失败')).toBeVisible()
  expect(screen.getByText('1 个已登记')).toBeVisible()
  expect(screen.getByText('1 个可用模型')).toBeVisible()
  expect(screen.getByText('1 个用户可选')).toBeVisible()
  expect(screen.getByText('8 个完整未登记')).toBeVisible()

  await userEvent.setup().click(screen.getByRole('button', {
    name: '逻辑回归：可用，查看模型详情',
  }))
  expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'models', resourceId: 'm1' })
})

it('shows package import failures and maintenance commands', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(path)
    if (auth) return auth
    const url = String(path)
    if (url.endsWith('/api/v1/model-candidates')) return Response.json({ candidates: [] })
    if (url.includes('/api/v1/models/coverage')) return Response.json(coverage())
    return Response.json({ models: [], methods: [], readiness: { ...READINESS, registeredModels: 0, readyModels: 0 } })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={vi.fn()}/>)
  const panel = await screen.findByLabelText('模型包交付')
  expect(within(panel).getByText('jit-models.zip')).toBeVisible()
  expect(within(panel).getByText('部分导入')).toBeVisible()
  expect(within(panel).getByText('a'.repeat(64))).toBeVisible()
  expect(within(panel).getByText('目标位置已有不同运行')).toBeVisible()
  expect(within(panel).getByText('维护命令')).toBeVisible()
  await userEvent.setup().click(within(panel).getByText('维护命令'))
  expect(within(panel).getByText(/import-models models\.zip/)).toBeVisible()
})

it('distinguishes an empty new environment from development artifacts', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(path)
    if (auth) return auth
    const url = String(path)
    if (url.endsWith('/api/v1/model-candidates')) return Response.json({ candidates: [] })
    if (url.includes('/api/v1/models/coverage')) {
      return Response.json({ datasets: [], total: 0, limit: 100, offset: 0, latestImport: null })
    }
    return Response.json({
      models: [], methods: [],
      readiness: {
        ...READINESS, ready: false, completeArtifacts: 0, unregisteredExperiments: 0,
        completeUnregisteredExperiments: 0, registeredModels: 0, readyModels: 0,
        repositorySelectableModels: 0, userSelectableModels: 0, defaultModelId: null,
        defaultAvailable: false, issues: [],
      },
    })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('当前部署环境没有模型包导入记录，也没有已登记模型。')).toBeVisible()
  expect(screen.queryByText('仓库 JIT 基准')).not.toBeInTheDocument()
  expect(screen.getByText('没有训练覆盖记录')).toBeVisible()
})

it('keeps network failure separate from an empty catalog and retries real requests', async () => {
  let modelCalls = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(path)
    if (auth) return auth
    const url = String(path)
    if (url.endsWith('/api/v1/models')) {
      modelCalls += 1
      if (modelCalls === 1) throw new TypeError('connection refused')
    }
    if (url.endsWith('/api/v1/model-candidates')) return Response.json({ candidates: [] })
    if (url.includes('/api/v1/models/coverage')) {
      return Response.json({ datasets: [], total: 0, limit: 100, offset: 0, latestImport: null })
    }
    return Response.json({ models: [], methods: [], readiness: READINESS })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'models' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('无法连接模型后端，请检查服务后重试。')).toBeVisible()
  expect(screen.queryByText(/仓库 JIT 基准|逻辑回归/)).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(modelCalls).toBe(2))
  expect(await screen.findByText('尚无已登记模型')).toBeVisible()
})
