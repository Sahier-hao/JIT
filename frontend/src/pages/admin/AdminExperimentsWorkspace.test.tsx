import { render, screen, waitFor } from '../../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminWorkspace } from '../AdminWorkspace'
import { response } from '../../projectActivity.fixture'

afterEach(() => vi.restoreAllMocks())

const REPORT_ID = 'abc123def4567890abc12345'
const NOW = '2026-10-30T11:05:14Z'
const protocols = ['local', 'pooled', 'leave-one-project-out', 'global+local']

function aggregate(value: number, variance = 0.01) {
  return {
    direction: 'maximize', definedCount: 1, macroMean: value, populationVariance: variance,
    worstProject: { project: 'p1', value }, undefined: [],
  }
}
function metrics(forMissing = false) {
  return {
    averagePrecision: { value: 0.5, reason: null },
    rocAuc: { value: 0.75, reason: null },
    recall20Loc: forMissing ? { value: null, reason: '测试分区没有正例' } : { value: 0.1, reason: null },
    popt: { value: 0.9, reason: null },
    f1: { value: 0.2, reason: null },
    ifa: { value: 1, reason: null },
  }
}
function target(project = 'p1', blend = false) {
  return {
    project, status: 'succeeded', trainingProjects: [project], trainingSeconds: 0.1,
    metrics: metrics(!blend), targetTest: { count: 2, positiveCount: 1, firstEpoch: 1, lastEpoch: 2, idDigest: 'd' },
    ...(blend ? { blend: { alphaGlobal: 0.4, alphaLocal: 0.6, validationCount: 238, validationPositiveCount: 31, validationBrier: 0.0969786949, selectionData: 'target-validation' } } : {}),
  }
}
function summaryMetrics() {
  return Object.fromEntries(['averagePrecision', 'rocAuc', 'recall20Loc', 'popt', 'f1', 'ifa']
    .map(name => [name, aggregate(name === 'averagePrecision' ? 0.5 : 0.25)]))
}
const rawReport = {
  kind: 'multi-project-training-report', reportVersion: 1, generatedUtc: NOW,
  schema: 'kamei14-git-v1', metricSet: 'metric-set-v2', protocols, methods: ['logistic-regression-l2-v1'],
  projects: [{
    name: 'p1', dataset: 'p1', version: 'p1-2022-01-01_2025-01-01', status: 'succeeded',
    includedRows: 10, positiveLabels: 2, schema: 'kamei14-git-v1', url: 'https://example.invalid/p1',
    revision: 'a'.repeat(40), labelSemantics: { rule: 'szz-simple-v1', limitations: ['简化 SZZ'] },
    partitions: { train: { count: 6, positiveCount: 1 }, validation: { count: 2, positiveCount: 1 }, test: { count: 2, positiveCount: 1 } },
  }],
  results: {
    'logistic-regression-l2-v1': Object.fromEntries(protocols.map(name => [name, {
      status: 'complete', targets: [target('p1', name === 'global+local')],
      summary: { metrics: summaryMetrics(), worstProjectByPrimaryMetric: { metric: 'averagePrecision', project: 'p1', value: 0.5 } },
    }])),
  },
  failures: [{ status: 'failed', stage: 'fit', code: 'MODEL_INVALID', message: '融合失败', method: 'logistic-regression-l2-v1', protocol: 'global+local', project: 'p1', trainingProjects: ['p1'] }],
  boundary: { offlineOnly: true, automaticModelSelection: false, defaultModelChanged: false, bestMethodDeclared: false, crossProjectMetricsAreMacroAverages: true },
  environment: { python: '3.14.2', platform: 'test', packages: {} },
  sourceCode: { 'multi_project.py': 'b'.repeat(64) },
  status: 'complete-with-failures',
}
function summary(overrides: Record<string, unknown> = {}) {
  return {
    reportId: REPORT_ID, source: 'docs/evidence/demo/multi-project-report.json',
    status: 'complete', reportStatus: 'complete', generatedUtc: NOW, schema: 'kamei14-git-v1',
    metricSet: 'metric-set-v2', protocols, methods: ['logistic-regression-l2-v1'],
    projectCount: 1, failedProjectCount: 0, failureCount: 0, methodCount: 1, protocolCount: 4,
    resultCount: 4, partialProtocolCount: 0, completeProtocolCount: 4, failedProtocolCount: 0,
    error: null, ...overrides,
  }
}

function api(list = [summary()], detail = { ...summary({ status: 'partial', reportStatus: 'complete-with-failures' }), report: rawReport }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const url = String(path)
    if (url.endsWith('/api/admin/session')) return response({ authenticated: true, setupRequired: false, username: 'admin' })
    if (url.endsWith('/api/admin/multi-project-reports')) return response({ reports: list, total: list.length })
    return response(detail)
  })
}

it('lists real report statuses and opens a controlled report id', async () => {
  const list = [
    summary(),
    summary({ reportId: 'bbbbbbbbbbbbbbbbbbbbbbbb', status: 'partial', failureCount: 2, partialProtocolCount: 1, failedProtocolCount: 1 }),
    summary({ reportId: 'cccccccccccccccccccccccc', status: 'failed', failedProjectCount: 1, failureCount: 1, completeProtocolCount: 0, failedProtocolCount: 4 }),
  ]
  api(list)
  const navigate = vi.fn()
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments' }} navigate={navigate}/>)
  expect(await screen.findByRole('heading', { name: '多项目实验' })).toBeVisible()
  expect(screen.getByText('完整')).toBeVisible()
  expect(screen.getByText('部分失败')).toBeVisible()
  expect(screen.getAllByText('失败').length).toBeGreaterThan(1)
  expect(screen.getAllByText('查看')).toHaveLength(3)
  await userEvent.setup().click(screen.getAllByRole('button', { name: '查看' })[0])
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'experiments', resourceId: REPORT_ID }))
})

it('shows four protocols, macro mean and variance, fusion weights and failure reasons without filling missing metrics with zero', async () => {
  api()
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments', resourceId: REPORT_ID }} navigate={vi.fn()}/>)
  expect(await screen.findByRole('heading', { name: '多项目实验报告' })).toBeVisible()
  for (const label of ['本地训练', '合并训练', '留一项目', '全局+本地']) {
    expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0)
  }
  expect(screen.getAllByText('0.5000').length).toBeGreaterThan(0)
  expect(screen.getAllByText('0.0100').length).toBeGreaterThan(0)
  const globalSummary = screen.getAllByText('全局+本地', { exact: false }).find(element => element.tagName === 'SUMMARY')
  expect(globalSummary).toBeTruthy()
  await userEvent.setup().click(globalSummary!)
  expect(await screen.findByText('全局 0.4 / 本地 0.6')).toBeVisible()
  expect(screen.getByText(/验证 Brier 0.0970/)).toBeVisible()
  expect(screen.getByText(/MODEL_INVALID/)).toBeVisible()
  expect(screen.getAllByText('测试分区没有正例').length).toBeGreaterThan(0)
  expect(screen.queryByText('0.0000')).not.toBeInTheDocument()
  expect(screen.getByText(/只读报告；宏平均不是全局最佳模型/)).toBeVisible()
})

it('returns to the experiment list from a missing report', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/api/admin/session')) return response({ authenticated: true, setupRequired: false, username: 'admin' })
    return response({ error: { code: 'REPORT_NOT_FOUND', message: '多项目实验报告不存在', requestId: 'r' } }, 404)
  })
  const navigate = vi.fn()
  render(<AdminWorkspace route={{ name: 'admin', view: 'experiments', resourceId: 'missing' }} navigate={navigate}/>)
  expect(await screen.findByText('多项目实验报告不可用')).toBeVisible()
  expect(screen.getByText('多项目实验报告不存在')).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '返回实验列表' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'admin', view: 'experiments' })
})
