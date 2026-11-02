import { act, render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from './AdminWorkspace'

afterEach(() => vi.restoreAllMocks())

const FULL_RUN = {
  candidateId: 'a'.repeat(64),
  displayName: 'suites/demo/logistic-regression-l2-v1',
  artifactKey: 'suites/demo/logistic-regression-l2-v1',
  artifactState: 'complete',
  artifactStateReason: null,
  manifestSha256: 'b'.repeat(64),
  artifactRunId: 'run-a',
  runId: null,
  modelId: null,
  modelState: null,
  registrationState: 'unregistered',
  enabled: null,
  isDefault: null,
  method: 'logistic-regression-l2-v1',
  name: '实验甲',
  featureSchemaVersion: 'kamei14-git-v1',
  datasetVersion: 'repo-v1',
  metricSet: 'metric-set-v2',
  metrics: {
    averagePrecision: { value: 0.5, reason: null },
    rocAuc: { value: 0.7, reason: null },
  },
  trainingSeconds: 1.2,
  split: {},
  source: {},
  limitations: ['提交级聚合'],
  serviceCompatibility: 'repository-analysis',
  serviceCompatibilityReason: null,
  promotable: true,
  locations: [{
    candidateId: 'a'.repeat(64),
    artifactKey: 'suites/demo/logistic-regression-l2-v1',
    artifactState: 'complete',
    manifestSha256: 'b'.repeat(64),
    reason: null,
  }],
}

const OFFLINE_RUN = {
  ...FULL_RUN,
  candidateId: 'c'.repeat(64),
  displayName: 'suites/jit-fine/logistic-regression-l2-v1',
  artifactKey: 'suites/jit-fine/logistic-regression-l2-v1',
  manifestSha256: 'd'.repeat(64),
  artifactRunId: 'run-b',
  name: '离线基准',
  featureSchemaVersion: 'kamei14-benchmark-v1',
  datasetVersion: 'jit-fine-v1',
  serviceCompatibility: 'offline-only',
  serviceCompatibilityReason: '该特征 schema 仅支持离线基准，不接入用户仓库分析。',
  locations: [{
    candidateId: 'c'.repeat(64),
    artifactKey: 'suites/jit-fine/logistic-regression-l2-v1',
    artifactState: 'complete',
    manifestSha256: 'd'.repeat(64),
    reason: null,
  }],
}

function session(path: string) {
  return String(path).endsWith('/api/admin/session') ? Response.json({ authenticated: true, username: 'admin' }) : null
}

it('lists experiment runs and promotes an explicit batch with partial results', async () => {
  const navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    const auth = session(String(path))
    if (auth) return auth
    if (String(path).endsWith('/api/v1/experiment-runs/promote') && options?.method === 'POST') {
      return Response.json({
        items: [
          { candidateId: FULL_RUN.candidateId, status: 'registered', modelId: 'model-1', runId: 'business-run-1', code: null, message: null },
          { candidateId: OFFLINE_RUN.candidateId, status: 'failed', modelId: null, runId: null, code: 'ARTIFACT_INVALID', message: '产物校验失败' },
        ],
        registered: 1,
        failed: 1,
      })
    }
    return Response.json({
      runs: [FULL_RUN, OFFLINE_RUN],
      reports: [{ artifactKey: 'multi-project/report.json', registrationEligible: false, reason: '聚合报告不含完整模型产物，不能登记为模型。' }],
      total: 2,
      limit: 20,
      offset: 0,
    })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments' }} navigate={navigate}/>)
  expect(await screen.findByText('实验甲')).toBeVisible()
  expect(screen.getAllByText('AP 0.5000 · ROC-AUC 0.7000')).toHaveLength(2)
  expect(screen.getAllByText('仅离线基准').length).toBeGreaterThan(0)
  expect(screen.getByText('聚合报告不含完整模型产物，不能登记为模型。')).toBeVisible()
  const user = userEvent.setup()
  const statusFilter = screen.getByLabelText('登记状态')
  statusFilter.focus()
  await user.selectOptions(statusFilter, 'unregistered')
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ view: 'experiments', registrationState: 'unregistered' }))
  const first = screen.getByRole('checkbox', { name: '选择实验 run-a' })
  first.focus()
  await user.keyboard(' ')
  expect(first).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: '选择实验 run-b' }))
  await user.click(screen.getByRole('button', { name: '登记所选' }))
  await user.click(screen.getByRole('button', { name: '确认登记' }))
  expect(await screen.findByText('产物校验失败')).toBeVisible()
  expect(screen.queryByText('复用已有模型')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看模型' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'models', resourceId: 'model-1' })
  await waitFor(() => expect(screen.getByText('登记结果')).toBeVisible())
})

it('shows an experiment detail with provenance and metric limitations', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => session(String(path)) ?? Response.json(FULL_RUN))
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments', resourceId: FULL_RUN.candidateId }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '实验甲' })).toBeVisible()
  expect(screen.getByText('suites/demo/logistic-regression-l2-v1')).toBeVisible()
  expect(screen.getByText('提交级聚合')).toBeVisible()
  expect(screen.getByText(/可用于仓库分析/)).toBeVisible()
})

it('shows loading and empty states', async () => {
  let release: ((response: Response) => void) | undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const auth = session(String(path))
    if (auth) return auth
    return new Promise(resolve => { release = resolve })
  })
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('正在盘点实验运行')).toBeVisible()
  await act(async () => {
    release?.(Response.json({ runs: [], reports: [], total: 0, limit: 20, offset: 0 }))
    await Promise.resolve()
  })
  expect(await screen.findByText('当前筛选没有实验运行。')).toBeVisible()
})

it('shows a recoverable error state', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => session(String(path)) ?? Response.json({ error: { code: 'STORAGE_UNAVAILABLE', message: '目录库不可用', requestId: 'experiments' } }, { status: 503 }))
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments' }} navigate={vi.fn()}/>)
  expect(await screen.findByText('目录库不可用')).toBeVisible()
  expect(screen.getByRole('button', { name: '刷新' })).toBeVisible()
})
