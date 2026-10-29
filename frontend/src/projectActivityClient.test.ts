import { afterEach, expect, it, vi } from 'vitest'
import { checkTracking, createTrendView, getTracking, getTrendView, parseProjectPRs, parseTrendView, projectEvents, projectPRs, trendCommits, updateTracking } from './projectActivityClient'
import { event, PROJECT, prPage, response, tracking, trendView } from './projectActivity.fixture'
afterEach(() => vi.restoreAllMocks())
it('keeps PR cache GET read-only and refresh explicit with exact filters', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(prPage({ page: 2 })))
  await projectPRs(PROJECT, 'closed', 2)
  expect(fetch.mock.calls[0][0]).toBe(`/api/v1/repositories/${PROJECT}/pull-requests?state=closed&page=2`)
  expect(fetch.mock.calls[0][1]?.method).toBe('GET')
  await projectPRs(PROJECT, 'all', 2, true)
  expect(fetch.mock.calls[1][0]).toBe(`/api/v1/repositories/${PROJECT}/pull-requests/refresh?state=all&page=2`)
  expect(fetch.mock.calls[1][1]?.method).toBe('POST')
  expect(fetch.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true)
})
it('rejects cross-project PR pages and incorrect page identities', async () => {
  expect(() => parseProjectPRs(prPage({ repositoryId: 'other' }), PROJECT)).toThrow('当前项目')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(prPage({ page: 3 })))
  await expect(projectPRs(PROJECT, 'open', 1)).rejects.toThrow('页码')
})
it('sends only public tracking configuration and preserves explicit model identity', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(tracking()))
  await getTracking(PROJECT)
  await updateTracking(PROJECT, { enabled: true, modelId: 'model-original', intervalSeconds: 300, confirmExisting: true })
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ enabled: true, modelId: 'model-original', intervalSeconds: 300, confirmExisting: true })
  await checkTracking(PROJECT)
  expect(fetch.mock.calls[2][0]).toBe(`/api/v1/repositories/${PROJECT}/pr-tracking/check`)
})
it('loads global and project facts with pagination and rejects foreign project facts', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ events: [event()], total: 21, limit: 20, offset: 20 }))
  await projectEvents(undefined, 20)
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/project-events?limit=20&offset=20')
  await projectEvents(PROJECT, 20)
  fetch.mockResolvedValue(response({ events: [event({ repositoryId: 'foreign' })], total: 1, limit: 20, offset: 0 }))
  await expect(projectEvents(PROJECT)).rejects.toThrow('归属不一致')
})
it('keeps empty and small-sample trend values null, never substituting zeros', () => {
  const parsed = parseTrendView(trendView(), PROJECT)
  expect(parsed.buckets[1]).toMatchObject({ commitCount: null, highCount: null, highRate: null })
  expect(parsed.buckets[2].highRate).toBeNull()
  const bad = trendView(); bad.buckets[2].highRate = 0
  expect(() => parseTrendView(bad, PROJECT)).toThrow('小样本')
  expect(() => parseTrendView(trendView(), PROJECT, 'other-view')).toThrow('固定来源')
})
it('creates a fixed trend query and drills down only through its frozen source list', async () => {
  const view = trendView(), fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response(view))
  await createTrendView(PROJECT, { sourceSyncId: 's1', grain: 'week', start: '2026-10-01', end: '2026-10-29' })
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ sourceSyncId: 's1', grain: 'week', start: '2026-10-01', end: '2026-10-29' })
  await getTrendView(PROJECT, view.viewId)
  expect(fetch.mock.calls[1][1]?.method).toBe('GET')
  fetch.mockResolvedValue(response({ repositoryId: PROJECT, viewId: view.viewId, total: 1, limit: 50, offset: 0, commits: [{ commitId: 'abc', epoch: 1, risk: null, subject: '标题', sourceSyncId: 's2' }] }))
  expect((await trendCommits(PROJECT, view, view.buckets[0])).commits[0].sourceSyncId).toBe('s2')
  fetch.mockResolvedValue(response({ repositoryId: PROJECT, viewId: view.viewId, total: 1, limit: 50, offset: 0, commits: [{ commitId: 'abc', epoch: 1, risk: .2, subject: '标题', sourceSyncId: 'not-pinned' }] }))
  await expect(trendCommits(PROJECT, view, view.buckets[0])).rejects.toThrow('不在固定趋势')
})
it('allows old source metadata only as an explicit single-analysis fixed view', () => {
  const old = trendView({ mode: 'single', group: { groupId: null, branch: 'main', modelId: null, runId: null, featureSchemaVersion: null, distributionRule: null, sourceSyncIds: ['s1'] }, sourceSyncIds: ['s1'], summary: { commitCount: 4, scoredCount: 4, unknownCount: 0, highCount: null, highRate: null, riskMean: .3, rateReason: '旧口径未登记' } })
  expect(parseTrendView(old, PROJECT).summary.highCount).toBeNull()
})
