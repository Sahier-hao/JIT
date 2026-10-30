import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectTrends, trendOption } from './ProjectTrends'
import { GROUP, PROJECT, response, trendView } from '../projectActivity.fixture'
afterEach(() => vi.restoreAllMocks())
function api(overrides: { conflict?: boolean; commitsSource?: string } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).endsWith('/trend-groups')) return response({ repositoryId: PROJECT, groups: [GROUP], limitations: [] })
    if (String(path).includes('/commits?')) return response({ repositoryId: PROJECT, viewId: 'view-fixed', total: 1, limit: 50, offset: 0, commits: [{ commitId: 'a'.repeat(40), epoch: 1, risk: .8, subject: '原分析提交', sourceSyncId: overrides.commitsSource ?? 's2' }] })
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
  expect(document.querySelectorAll('.ui-chart svg')).toHaveLength(2)
  expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  const option = trendOption(trendView().buckets, 'risk', { series: '#2a78d6', seriesInk: '#104281', grid: '#e3e7ee', axis: '#cdd4df', text: '#4a5464', textStrong: '#111827', surface: '#ffffff', border: '#cdd4df', categorical: [], other: '#8a8a83' })
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
