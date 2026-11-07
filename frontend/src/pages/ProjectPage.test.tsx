import { render, screen, waitFor, within } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectPage } from './ProjectPage'
import { snapshot } from '../prReview.fixture'

const REPO = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'
const OTHER = '44444444-4444-4444-8444-444444444444'
const NOW = '2026-10-22T12:00:00Z'

/** 记录操作收在一个「更多操作」菜单里，测试先展开再点。 */
async function openActions(user: ReturnType<typeof userEvent.setup>, syncId: string) {
  const row = await screen.findByRole('article', { name: `分析记录 ${syncId}` })
  await user.click(within(row).getByRole('button', { name: '更多操作' }))
}

function detail(name = 'demo-project', view = SYNC) {
  return {
    repositoryId: REPO,
    url: 'https://github.com/example/demo',
    displayName: name,
    defaultBranch: 'main',
    latestSyncId: SYNC,
    latestSyncAt: NOW,
    viewSyncId: view,
    headCommit: 'a'.repeat(40),
    commitCount: 12,
    distribution: { high: 3, medium: 5, low: 4, unknown: 0 },
    distributionRule: 'repo-distribution-v1',
    createdAt: NOW,
    updatedAt: NOW,
    modelStrategy: 'repository-trained',
    degradeReason: null,
    runId: '33333333-3333-4333-8333-333333333333',
    modelId: null,
    datasetVersion: 'data-1',
    limitations: [],
    latestSync: job(),
    viewContext: { repositoryId: REPO, syncId: view, branch: 'main', completedAt: NOW, headCommit: 'a'.repeat(40), datasetVersion: 'data-1', modelId: null, runId: '33333333-3333-4333-8333-333333333333', missingMetadata: [] },
  }
}
function job(overrides: Record<string, unknown> = {}) {
  return {
    syncId: SYNC,
    repositoryId: REPO,
    repositoryUrl: 'https://github.com/example/demo',
    branch: 'main',
    since: null,
    until: null,
    commitLimit: 500,
    requestedStrategy: 'auto',
    status: 'completed',
    stage: 'completed',
    datasetVersion: 'data-1',
    runId: '33333333-3333-4333-8333-333333333333',
    modelId: null,
    modelStrategy: 'repository-trained',
    degradeReason: null,
    trainRecords: 12,
    trainPositives: 4,
    createdAt: NOW,
    updatedAt: NOW,
    requestId: null,
    error: null,
    ...overrides,
  }
}
function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mockApi(options: { onDeleteRecord?: () => void; onPost?: (body: unknown) => void; onSelect?: (body: unknown) => void } = {}) {
  let name = 'demo-project'
  let view = SYNC
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [job(), job({ syncId: OTHER, createdAt: '2026-10-21T12:00:00Z' })], total: 2, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/repositories/${REPO}` && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as { displayName?: string; viewSyncId?: string }
      if (body.viewSyncId) {
        options.onSelect?.(body)
        view = body.viewSyncId
        return response(detail(name, view))
      }
      name = String(body.displayName)
      return response(detail(name, view))
    }
    if (url.pathname === `/api/v1/repositories/${REPO}`) return response(detail(name, view))
    if (url.pathname === '/api/v1/repository-syncs' && method === 'POST') {
      options.onPost?.(JSON.parse(String(init?.body)))
      return response(job(), 202)
    }
    if (url.pathname === `/api/v1/repository-syncs/${SYNC}` && method === 'DELETE') {
      options.onDeleteRecord?.()
      return response(null, 204)
    }
    return response(detail(name, view))
  })
}

it('opens a comparison of a historical success against the pinned current result without changing it', async () => {
  const fetch = mockApi(), navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/> )
  const user = userEvent.setup()
  await openActions(user, OTHER)
  await user.click(await screen.findByRole('menuitem', { name: '与当前结果对比' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'comparison', repositoryId: REPO, baseSyncId: OTHER, targetSyncId: SYNC })
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
})

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

it('retries a cancelled analysis with branch and strategy but without a hidden date window', async () => {
  sessionStorage.clear()
  let posted: unknown = null
  const fetch = mockApi({ onPost: value => { posted = value } }); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'cancelled', stage: 'collecting', since: '2024-01-01T00:00:00+00:00', until: '2024-01-09T00:00:00+00:00' })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  await openActions(user, SYNC)
  await user.click(await screen.findByRole('menuitem', { name: '用这些参数重试' }))
  expect(await screen.findByRole('group', { name: '分析选项' })).toBeInTheDocument()
  expect(screen.queryByLabelText('起始日期')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).not.toBeNull())
  expect(posted).toMatchObject({ branch: 'main', strategy: 'auto' })
  expect(posted).not.toHaveProperty('since')
  expect(posted).not.toHaveProperty('until')
  expect(posted).not.toHaveProperty('commitLimit')
})

it('shows queue position and confirms cancellation while preserving the current result', async () => {
  let cancelled = false
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    const queued = job({ syncId: OTHER, status: cancelled ? 'cancelled' : 'queued', stage: 'queued',
      queuePosition: cancelled ? null : 2, cancelRequestedAt: cancelled ? NOW : null })
    if (url.pathname === `/api/v1/repository-syncs/${OTHER}/cancel`) { cancelled = true; return response({ ...queued, status: 'cancelled', cancelRequestedAt: NOW }) }
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [queued, job()], total: 2, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  expect((await screen.findAllByText('排队第 2 位')).length).toBeGreaterThan(0)
  await openActions(user, OTHER)
  await user.click(await screen.findByRole('menuitem', { name: '取消分析' }))
  expect(cancelled).toBe(false)
  await user.click(screen.getByRole('button', { name: '确认取消分析' }))
  expect(await screen.findByText('已取消')).toBeVisible()
  await openActions(user, OTHER)
  expect(await screen.findByRole('menuitem', { name: '用这些参数重试' })).toBeVisible()
  expect(screen.getByRole('button', { name: '查看提交明细' })).toBeVisible()
})

it('keeps a cancellation error actionable and prevents repeated submissions', async () => {
  let requests = 0
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/cancel')) { requests++; return response({ error: { code: 'SYNC_NOT_ACTIVE', message: '分析已结束，请刷新', requestId: 'fixture' } }, 409) }
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'scoring', stage: 'scoring' })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  await openActions(user, SYNC)
  await user.click(await screen.findByRole('menuitem', { name: '取消分析' }))
  await user.click(screen.getByRole('button', { name: '确认取消分析' }))
  expect(await screen.findByText('分析已结束，请刷新')).toBeVisible()
  expect(requests).toBe(1)
})

it('shows pending cancellation and does not offer deletion before the worker exits', async () => {
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'collecting', stage: 'collecting', cancelRequestedAt: NOW })], total: 1, limit: 10, offset: 0 })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>)
  expect(await screen.findByText('正在取消')).toBeVisible()
  expect(screen.queryByRole('button', { name: '删除记录' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '取消分析' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除记录' })).not.toBeInTheDocument()
})

it('shows the current result and opens the pinned review', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/>)
  expect(await screen.findByRole('heading', { name: 'demo-project' })).toBeVisible()
  expect(screen.getByRole('heading', { name: '当前分析结果' })).toBeVisible()
  expect(screen.getAllByText('data-1')[0]).toBeVisible()
  await userEvent.setup().click(screen.getByRole('button', { name: '查看提交明细' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'analysis', repositoryId: REPO, viewSyncId: SYNC, view: 'commits' })
})

it('opens the current analysis dataset without leaving the pinned result', async () => {
  const fetch = mockApi(), original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === `/api/v1/repositories/${REPO}/analyses/${SYNC}/dataset`) {
      return response({
        syncId: SYNC, datasetId: 'demo-project', version: 'demo-project-2024-01-01_2024-12-31',
        schema: 'kamei14-git-v2', timeRange: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T00:00:00Z' },
        quality: { rawRows: 120, includedRows: 100, positiveLabels: 20 },
        file: { name: 'demo.csv', sha256: 'a'.repeat(64), bytes: 2048 },
        source: { publisher: 'fixture', url: 'https://example.com/repo', revision: 'b'.repeat(40), citation: null, branch: 'main', head: 'c'.repeat(40), window: null },
        labelRule: '简化 SZZ', limitations: ['提交级聚合'],
      })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '数据来源' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('demo-project-2024-01-01_2024-12-31')).toBeVisible()
  expect(within(dialog).getByText('a'.repeat(64))).toBeVisible()
  expect(within(dialog).getByRole('button', { name: '下载 CSV 包' })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: '下载 XLSX' })).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: '返回结果' }))
  expect(screen.getByRole('button', { name: '查看提交明细' })).toBeVisible()
})

it('posts a new analysis with the chosen branch and the default strategy', async () => {
  let posted: unknown = null
  mockApi({ onPost: body => { posted = body } })
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '发起分析' }))
  expect(await screen.findByRole('group', { name: '分析选项' })).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: '分支' }), 'release')
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).not.toBeNull())
  expect(posted).toEqual({ repositoryUrl: 'https://github.com/example/demo', branch: 'release', strategy: 'auto', splitPreset: 'temporal-70-15-15' })
})

it('returns to the project list from the back link', async () => {
  mockApi()
  const navigate = vi.fn()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/>)
  await screen.findByRole('heading', { name: 'demo-project' })
  await userEvent.setup().click(screen.getByRole('button', { name: '全部项目' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repositories' })
})

it('switches the current result from an older completed record', async () => {
  let selected: unknown = null
  mockApi({ onSelect: body => { selected = body } })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  const menus = await screen.findAllByRole('button', { name: '更多操作' })
  await user.click(menus[1])
  await user.click(await screen.findByRole('menuitem', { name: '设为当前结果' }))
  await waitFor(() => expect(selected).not.toBeNull())
  expect(selected).toEqual({ viewSyncId: OTHER })
  await waitFor(() => expect(screen.getAllByText('当前结果').length).toBeGreaterThan(0))
  expect(await screen.findByText(/当前结果已切换为/)).toBeVisible()
  expect(await screen.findByText('历史固定结果')).toBeVisible()
})

it('deletes an ended analysis record from the list', async () => {
  const deleted = vi.fn()
  mockApi({ onDeleteRecord: deleted })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click((await screen.findAllByRole('button', { name: '更多操作' }))[0])
  await user.click(await screen.findByRole('menuitem', { name: '删除记录' }))
  expect(deleted).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认删除记录' }))
  await waitFor(() => expect(deleted).toHaveBeenCalled())
})

it('keeps following a queued job until the result is available', async () => {
  let reads = 0
  let started = false
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/v1/repository-syncs' && init?.method === 'POST') { started = true; return response(job({ status: 'queued', stage: 'queued' }), 202) }
    if (url.pathname.endsWith('/syncs')) {
      const complete = started && ++reads > 1
      return response({ repositoryId: REPO, syncs: [job({ status: complete ? 'completed' : 'queued', stage: complete ? 'completed' : 'queued' })], total: 1, limit: 10, offset: 0 })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '发起分析' }))
  await user.click(await screen.findByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(document.querySelectorAll('.record-pin').length).toBeGreaterThan(0), { timeout: 7000 })
})

it('lets users reach an older analysis beyond the first ten', async () => {
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/syncs')) {
      const offset = Number(url.searchParams.get('offset'))
      return response({ repositoryId: REPO, syncs: offset ? [job({ syncId: OTHER })] : Array.from({ length: 10 }, (_, i) => job({ syncId: `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111` })), total: 11, limit: 10, offset })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'demo-project' })
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(await screen.findByRole('article', { name: `分析记录 ${OTHER}` })).toBeVisible()
})

it('restores the bound fallback model on retry even if the administrator default changed', async () => {
  sessionStorage.clear()
  let posted: unknown = null
  const fetch = mockApi({ onPost: value => { posted = value } }); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/syncs')) return response({ repositoryId: REPO, syncs: [job({ status: 'failed', stage: 'training', requestedStrategy: 'auto', requestedModelId: null, resolvedModelId: 'old-model', modelStrategy: 'generic-model', error: { code: 'MODEL_DISABLED', message: '停用' } })], total: 1, limit: 10, offset: 0 })
    if (url.pathname.endsWith('/repository-models')) return response({ models: [
      { modelId: 'old-model', name: '原模型', method: 'lr', state: 'ready', repositoryPredictionSupported: true, enabled: true, isDefault: false },
      { modelId: 'new-default', name: '新默认', method: 'dt', state: 'ready', repositoryPredictionSupported: true, enabled: true, isDefault: true },
    ] })
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>); const user = userEvent.setup()
  await openActions(user, SYNC)
  await user.click(await screen.findByRole('menuitem', { name: '用这些参数重试' }))
  await waitFor(() => expect(screen.getByLabelText('模型来源')).toHaveValue('old-model'))
  await waitFor(() => expect(screen.getByRole('button', { name: '开始分析' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(posted).toMatchObject({ modelId: 'old-model', strategy: 'generic-model' }))
})



it('switches project subviews without dropping project identity', async () => {
  mockApi(); const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/>)
  await user.click(await screen.findByRole('button', { name: 'PR 审查' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: REPO, tab: 'prs' })
  await user.click(screen.getByRole('button', { name: '风险趋势' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: REPO, tab: 'trends' })
})

it('opens a PR-sourced record at its fixed snapshot and never offers branch retry', async () => {
  const SNAP = '55555555-5555-4555-8555-555555555555'
  const source = snapshot(SNAP); source.repositoryId = REPO
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [job({ sourceKind: 'pr', origin: 'automatic', sourceSnapshotId: SNAP })], total: 1, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/pr-snapshots/${SNAP}`) return response(source)
    return response(detail())
  })
  const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={navigate}/>)
  const row = await screen.findByRole('article', { name: `分析记录 ${SYNC}` })
  await user.click(within(row).getByRole('button', { name: '更多操作' }))
  expect(screen.queryByRole('menuitem', { name: '用这些参数重试' })).not.toBeInTheDocument()
  await user.click(await screen.findByRole('menuitem', { name: '查看原 PR 快照' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: REPO, owner: 'example', repositoryName: 'project', number: 12, snapshotId: SNAP }))
})

it('explains an old current pointer that came from a PR analysis', async () => {
  const fetch = mockApi(), original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (input, init) => {
    if (new URL(String(input), 'http://localhost').pathname === `/api/v1/repositories/${REPO}`) {
      const base = detail()
      return response({ ...base, viewContext: { ...base.viewContext, sourceKind: 'pr' } })
    }
    return original(input, init)
  })
  render(<ProjectPage repositoryId={REPO} tab="analyses" navigate={vi.fn()}/>)
  expect(await screen.findByText(/当前结果来自旧 PR 分析/)).toBeVisible()
})

function overviewPayload() {
  return {
    repositoryId: REPO, supported: true, url: 'https://github.com/example/demo', displayName: 'demo-project',
    metadata: { fullName: 'example/demo', description: 'Demo repository', defaultBranch: 'main', private: false, stars: 12, forks: 3,
      openIssues: 5, watchers: 8, pushedAt: NOW, createdAt: NOW, topics: ['review'], license: 'MIT', homepage: null, htmlUrl: 'https://github.com/example/demo' },
    languages: [{ name: 'Python', bytes: 750, percent: 75 }, { name: 'TypeScript', bytes: 250, percent: 25 }],
    activity: Array.from({ length: 12 }, (_, index) => ({ weekStart: `2026-08-${String(index + 1).padStart(2, '0')}`, commits: index === 11 ? 3 : 0 })),
    activityCoverage: 'last-100-commits',
    recentCommits: [{ sha: 'a'.repeat(40), message: 'fix: demo', author: 'alice', date: NOW, url: 'https://github.com/example/demo/commit/a' }],
    fetchedAt: NOW, errorCode: null, stale: false, retryAfter: null,
  }
}
function updateState() {
  return { repositoryId: REPO, enabled: false, branch: 'HEAD', intervalSeconds: 300, status: 'idle', lastAttemptAt: null, lastCheckedAt: null, nextCheckAt: null, remoteHead: null, resolvedBranch: null, errorCode: null }
}
it('lands on the repository overview before any analysis and starts analysis explicitly', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === `/api/v1/repositories/${REPO}/overview`) return response(overviewPayload())
    if (url.pathname === `/api/v1/repositories/${REPO}/updates`) return response(updateState())
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [], total: 0, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/repositories/${REPO}`) return response({ ...detail(), viewSyncId: null, latestSync: null, latestSyncAt: null, viewContext: null, commitCount: 0, distribution: { high: 0, medium: 0, low: 0, unknown: 0 } })
    return response({})
  })
  const navigate = vi.fn(), user = userEvent.setup()
  render(<ProjectPage repositoryId={REPO} navigate={navigate}/>)
  expect(await screen.findByRole('region', { name: '仓库概览' })).toBeVisible()
  expect(await screen.findByText('仓库活跃度')).toBeVisible()
  expect(await screen.findByText('语言构成')).toBeVisible()
  expect(screen.queryByText('分析记录')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '发起第一次分析' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '发起分析' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('发起分析')
})
it('renders the 52-week activity curve, the language donut, and aggregates extra languages', async () => {
  localStorage.clear()
  const start = Date.parse('2025-11-03T00:00:00Z')
  const activity = Array.from({ length: 52 }, (_, index) => ({
    weekStart: new Date(start + index * 7 * 86_400_000).toISOString().slice(0, 10),
    commits: index === 51 ? 3 : index % 4,
  }))
  const languages = ['Python', 'TypeScript', 'Go', 'SQL', 'Rust', 'YAML', 'Shell', 'Dockerfile']
    .map((name, index) => ({ name, bytes: 800 - index * 50, percent: 20 - index * 1.5 }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === `/api/v1/repositories/${REPO}/overview`) {
      return response({ ...overviewPayload(), activity, activityCoverage: 'last-52-weeks', languages })
    }
    if (url.pathname === `/api/v1/repositories/${REPO}/updates`) return response(updateState())
    if (url.pathname === `/api/v1/repositories/${REPO}/syncs`) return response({ repositoryId: REPO, syncs: [], total: 0, limit: 10, offset: 0 })
    if (url.pathname === `/api/v1/repositories/${REPO}`) return response({ ...detail(), viewSyncId: null, latestSync: null, latestSyncAt: null, viewContext: null, commitCount: 0, distribution: { high: 0, medium: 0, low: 0, unknown: 0 } })
    return response({})
  })
  const user = userEvent.setup()
  render(<ProjectPage repositoryId={REPO} navigate={vi.fn()}/>)
  expect(await screen.findByRole('img', { name: '最近 52 周每周提交量曲线' })).toBeVisible()
  expect(screen.getByText('近一年 · 按周')).toBeVisible()
  expect(await screen.findByRole('img', { name: /语言构成环形图/ })).toBeVisible()
  const legend = document.querySelector('.repo-language-legend') as HTMLElement
  expect(within(legend).getByText('其他')).toBeVisible()
  await user.click(screen.getAllByText('查看等价数据表')[0])
  const table = screen.getByRole('table', { name: '最近 52 周提交量' })
  expect(within(table).getAllByRole('row')).toHaveLength(53)
})
