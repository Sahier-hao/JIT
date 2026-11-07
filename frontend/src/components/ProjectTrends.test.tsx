import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectTrends, trendOption } from './ProjectTrends'
import { GROUP, PROJECT, response, trendView } from '../projectActivity.fixture'
afterEach(() => vi.restoreAllMocks())
function api(overrides: { conflict?: boolean; commitsSource?: string } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).endsWith('/trend-groups')) return response({ repositoryId: PROJECT, groups: [GROUP], limitations: [] })
    if (String(path).includes('/commits?')) return response({ repositoryId: PROJECT, viewId: 'view-fixed', total: 1, limit: 50, offset: 0, commits: [{ commitId: 'a'.repeat(40), epoch: 1, risk: .8, subject: '原分析提交', sourceSyncId: overrides.commitsSource ?? 's2', partition: 'test' }] })
    if (init?.method === 'POST' && overrides.conflict) return response({ error: { code: 'TREND_SOURCE_CONFLICT', message: '相同提交来源冲突', requestId: 'r', details: [{ field: 'sourceSyncIds', reason: '保存观测不一致', commitId: 'conflict-sha', sourceSyncIds: ['s1', 's2'], conflictingFields: ['epoch', 'risk'] }] } }, 409)
    return response(trendView({ hasNewSources: true }))
  })
}
it('opens fixed views via GET only, leaves new sources unapplied, and renders null gaps plus equivalent table', async () => {
  const fetch = api()
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={vi.fn()}/>)
  await screen.findByRole('table', { name: /趋势等价数据表/ })
  expect(screen.getByText('有新的分支分析来源，当前视图保持不变。')).toBeVisible()
  expect(screen.getAllByText('未知').length).toBeGreaterThan(0)
  expect(screen.getAllByText(/已评分样本不足 20/).length).toBeGreaterThan(0)
  expect(screen.getAllByRole('group', { name: /方向键/ })).toHaveLength(2)
  await waitFor(() => expect(document.querySelectorAll('.ui-chart svg')).toHaveLength(2))
  const strokes = Array.from(document.querySelectorAll('.ui-chart svg path')).map(path => path.getAttribute('stroke')).filter((value): value is string => Boolean(value))
  // jsdom 取不到 CSS 变量，颜色来自 ui/chart.tsx 的 fallback（常量是大写十六进制）
  expect(strokes.map(value => value.toLowerCase())).toContain('#1f5d4c')
  expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  const option = trendOption(trendView().buckets, 'risk', { series: '#1f5d4c', seriesInk: '#164537', grid: '#e4e7e5', axis: '#bdc4c1', text: '#5f6865', textStrong: '#101413', surface: '#ffffff', border: '#cdd4df', categorical: [], other: '#88908d' })
  const series = option.series as { data: unknown[]; connectNulls?: boolean }[]
  expect(series[0].data).toEqual([.42, null, .55])
  expect(series[0].connectNulls).toBe(false)
})
it('supports keyboard and touch-compatible bucket actions and preserves each commit sourceSyncId', async () => {
  api(); const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={navigate}/>)
  const chart = (await screen.findAllByRole('group', { name: /左右方向键选择时间段/ }))[0]
  chart.focus(); await user.keyboard('{Home}')
  const figure = chart.closest('figure')!
  await waitFor(() => expect(figure.querySelector('[role="status"]')).toHaveTextContent('2026-10-01 至 2026-10-08（不含）'))
  expect(figure.querySelector('[role="status"]')).toHaveTextContent('24 个已分析提交')
  await user.keyboard('{Enter}')
  await user.click(await screen.findByRole('button', { name: /原分析提交/ }))
  expect(navigate).toHaveBeenCalledWith({ name: 'analysis', repositoryId: PROJECT, viewSyncId: 's2', commitId: 'a'.repeat(40), view: 'commits' })
  expect(screen.getByRole('button', { name: '关闭提交下钻' })).toBeVisible()
})
it('does not select another group on a source conflict and allows explicit single-analysis query', async () => {
  const fetch = api({ conflict: true }), navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectTrends repositoryId={PROJECT} navigate={navigate}/>)
  await screen.findByRole('option', { name: /main \/ model-original/ })
  await user.selectOptions(screen.getByLabelText('趋势分析口径'), 'g1')
  await user.click(screen.getByRole('button', { name: '生成固定趋势' }))
  expect(await screen.findByText(/未自动选另一组或丢弃样本/)).toBeVisible()
  expect(screen.getByText('conflict-sha')).toBeVisible()
  expect(screen.getByText(/冲突来源 s1、s2 · 字段 epoch、risk/)).toBeVisible()
  expect(screen.getByLabelText('趋势分析口径')).toHaveValue('g1')
  await user.selectOptions(screen.getByLabelText('趋势来源范围'), 's1')
  await user.click(screen.getByRole('button', { name: '生成固定趋势' }))
  const bodies = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init?.body)))
  expect(bodies).toContainEqual({ groupId: 'g1', grain: 'week' })
  expect(bodies.at(-1)).toEqual({ sourceSyncId: 's1', grain: 'week' })
  expect(navigate).not.toHaveBeenCalled()
})
it('refreshes only with an explicit new fixed view action and keeps the end date exclusive', async () => {
  const fetch = api(), navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={navigate}/>)
  await screen.findByRole('table')
  await user.click(screen.getByRole('button', { name: '生成新的固定视图' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: PROJECT, tab: 'trends', viewId: 'view-fixed' }))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toEqual({ groupId: 'g1', start: '2026-10-01', end: '2026-10-29', grain: 'week' })
})
it('keeps a group view with only one original source in group mode when new sources arrive', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/trend-groups') ? response({ repositoryId: PROJECT, groups: [GROUP], limitations: [] }) : response(trendView({ sourceSyncIds: ['s1'], mode: 'group', hasNewSources: true })))
  const user = userEvent.setup()
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={vi.fn()}/>)
  await screen.findByRole('table')
  await user.click(screen.getByRole('button', { name: '调整口径' }))
  expect(screen.getByLabelText('单次固定分析标识')).toHaveValue('')
  await user.click(screen.getByRole('button', { name: '生成新的固定视图' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
  const body = JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))
  expect(body.groupId).toBe('g1')
  expect(body.sourceSyncId).toBeUndefined()
})
it('does not offer a foreign source when a drilldown response violates the frozen view', async () => {
  api({ commitsSource: 'foreign' }); const user = userEvent.setup()
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={vi.fn()}/>)
  await user.click((await screen.findAllByRole('button', { name: '查看提交' }))[0])
  expect(await screen.findByText('提交来源不在固定趋势中')).toBeVisible()
  expect(screen.queryByRole('button', { name: /原分析提交/ })).not.toBeInTheDocument()
})

it('shows verified partition boundaries as text in the chart legend and equivalent table', async () => {
  const payload = trendView({
    partitionCoverage: {
      status: 'verified', reason: null, preset: 'temporal-70-15-15', timezone: 'UTC',
      boundaries: [
        { epoch: 1, time: '2026-10-08T00:00:00Z' },
        { epoch: 2, time: '2026-10-22T00:00:00Z' },
      ],
      partitions: {
        train: { records: 22, positives: 4, start: '2026-10-01T00:00:00Z', end: '2026-10-07T00:00:00Z' },
        validation: { records: 20, positives: 2, start: '2026-10-08T00:00:00Z', end: '2026-10-21T00:00:00Z' },
        test: { records: 20, positives: 3, start: '2026-10-22T00:00:00Z', end: '2026-10-29T00:00:00Z' },
      },
    },
    buckets: [
      { start: '2026-10-01', end: '2026-10-08', commitCount: 22, scoredCount: 22, unknownCount: 0, highCount: 2, highRate: 2 / 22, riskMean: .4, rateReason: null, coverage: 'observed', partitions: { train: 22, validation: 0, test: 0, recentUnseen: 0, unknown: 0 } },
      { start: '2026-10-08', end: '2026-10-22', commitCount: 20, scoredCount: 20, unknownCount: 0, highCount: 2, highRate: .1, riskMean: .3, rateReason: null, coverage: 'observed', partitions: { train: 0, validation: 20, test: 0, recentUnseen: 0, unknown: 0 } },
      { start: '2026-10-22', end: '2026-10-29', commitCount: 20, scoredCount: 20, unknownCount: 0, highCount: 2, highRate: .1, riskMean: .5, rateReason: null, coverage: 'observed', partitions: { train: 0, validation: 0, test: 20, recentUnseen: 0, unknown: 0 } },
    ],
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/trend-groups') ? response({ repositoryId: PROJECT, groups: [GROUP], limitations: [] }) : response(payload))
  render(<ProjectTrends repositoryId={PROJECT} viewId="view-fixed" navigate={vi.fn()}/>)
  const legend = await screen.findByRole('region', { name: '训练分区覆盖' })
  expect(legend).toHaveTextContent('训练')
  expect(legend).toHaveTextContent('验证')
  expect(legend).toHaveTextContent('测试')
  expect(legend).toHaveTextContent('近期未训练')
  expect(screen.getAllByText('训练 22')).toHaveLength(1)
  expect(screen.getAllByText('验证 20')).toHaveLength(1)
  expect(screen.getAllByText('测试 20')).toHaveLength(1)
})
