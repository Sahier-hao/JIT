import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, riskNumber, text, textList, textOrNull } from './apiContract'
import { parseItem, type PRItem } from './prReviewClient'

const root = (id: string) => `/api/v1/repositories/${encodeURIComponent(id)}`
const count = (v: unknown) => { const n = finiteNumber(v); if (!Number.isSafeInteger(n) || n < 0) contractFailed(); return n }
const optionalCount = (v: unknown) => v == null ? null : count(v)
const identity = (raw: unknown, id: string) => { const b = record(raw); if (b.repositoryId !== id) contractFailed('返回内容不属于当前项目'); return b }
export type PRState = 'open' | 'closed' | 'all'
export interface ProjectPR extends PRItem { draft: boolean; snapshotId: string | null; analysisStatus: string | null; modelId: string | null; syncId: string | null; maxRisk: number | null; scoredCommits: number | null }
export interface ProjectPRPage { repositoryId: string; supported: boolean; owner: string | null; name: string | null; pullRequests: ProjectPR[]; page: number; hasMore: boolean; checkedAt: string | null; errorCode: string | null }
export function parseProjectPRs(raw: unknown, id: string): ProjectPRPage {
  const b = identity(raw, id)
  return { repositoryId: id, supported: flag(b.supported), owner: textOrNull(b.owner), name: textOrNull(b.name), pullRequests: recordList(b.pullRequests).map(p => ({ ...parseItem(p), draft: flag(p.draft), snapshotId: textOrNull(p.snapshotId), analysisStatus: textOrNull(p.analysisStatus), modelId: textOrNull(p.modelId), syncId: textOrNull(p.syncId), maxRisk: p.maxRisk == null ? null : riskNumber(p.maxRisk), scoredCommits: p.scoredCommits == null ? null : count(p.scoredCommits) })), page: count(b.page), hasMore: flag(b.hasMore), checkedAt: textOrNull(b.checkedAt), errorCode: textOrNull(b.errorCode) }
}
export async function projectPRs(id: string, state: PRState, page: number, refresh = false, signal?: AbortSignal) {
  const result = parseProjectPRs(await apiRequest({ path: `${root(id)}/pull-requests${refresh ? '/refresh' : ''}?state=${state}&page=${page}`, method: refresh ? 'POST' : 'GET', signal }), id)
  if (result.page !== page) contractFailed('PR 清单页码不一致')
  return result
}
export interface PRTracking { repositoryId: string; supported: boolean; enabled: boolean; modelId: string | null; intervalSeconds: number; status: string; lastCheckedAt: string | null; nextCheckAt: string | null; errorCode: string | null }
export function parseTracking(raw: unknown, id: string): PRTracking {
  const b = identity(raw, id)
  return { repositoryId: id, supported: flag(b.supported), enabled: flag(b.enabled), modelId: textOrNull(b.modelId), intervalSeconds: count(b.intervalSeconds), status: text(b.status), lastCheckedAt: textOrNull(b.lastCheckedAt), nextCheckAt: textOrNull(b.nextCheckAt), errorCode: textOrNull(b.errorCode) }
}
export async function getTracking(id: string, signal?: AbortSignal) { return parseTracking(await apiRequest({ path: `${root(id)}/pr-tracking`, method: 'GET', signal }), id) }
export async function updateTracking(id: string, body: { enabled: boolean; modelId?: string; intervalSeconds?: number; confirmExisting?: boolean }) { return parseTracking(await apiRequest({ path: `${root(id)}/pr-tracking`, method: 'PATCH', body }), id) }
export async function checkTracking(id: string) { return parseTracking(await apiRequest({ path: `${root(id)}/pr-tracking/check`, method: 'POST' }), id) }
export interface ProjectEvent { eventId: string; repositoryId: string; kind: string; createdAt: string; number: number | null; snapshotId: string | null; syncId: string | null; modelId: string | null; title: string; message: string; owner: string | null; name: string | null }
export interface EventPage { events: ProjectEvent[]; total: number; limit: number; offset: number }
export async function projectEvents(id?: string, offset = 0, signal?: AbortSignal): Promise<EventPage> {
  const b = record(await apiRequest({ path: `${id ? `${root(id)}/events` : '/api/v1/project-events'}?limit=20&offset=${offset}`, method: 'GET', signal }))
  const events = recordList(b.events).map(e => ({ eventId: text(e.eventId), repositoryId: text(e.repositoryId), kind: text(e.kind), createdAt: text(e.createdAt), number: optionalCount(e.number), snapshotId: textOrNull(e.snapshotId), syncId: textOrNull(e.syncId), modelId: textOrNull(e.modelId), title: text(e.title), message: text(e.message), owner: textOrNull(e.owner), name: textOrNull(e.name) }))
  if (id && events.some(e => e.repositoryId !== id)) contractFailed('项目动态归属不一致')
  if (b.offset !== offset) contractFailed('动态分页不一致')
  return { events, total: count(b.total), limit: count(b.limit), offset: count(b.offset) }
}
export interface TrendGroup { groupId: string | null; branch: string | null; modelId: string | null; runId: string | null; featureSchemaVersion: string | null; distributionRule: string | null; sourceSyncIds: string[] }
function parseGroup(raw: unknown): TrendGroup { const g = record(raw); return { groupId: textOrNull(g.groupId), branch: textOrNull(g.branch), modelId: textOrNull(g.modelId), runId: textOrNull(g.runId), featureSchemaVersion: textOrNull(g.featureSchemaVersion), distributionRule: textOrNull(g.distributionRule), sourceSyncIds: textList(g.sourceSyncIds) } }
export async function trendGroups(id: string, signal?: AbortSignal) { const b = identity(await apiRequest({ path: `${root(id)}/trend-groups`, method: 'GET', signal }), id); return { groups: recordList(b.groups).map(parseGroup), limitations: textList(b.limitations) } }
export interface TrendMeasures { commitCount: number | null; scoredCount: number | null; unknownCount: number | null; highCount: number | null; highRate: number | null; riskMean: number | null; rateReason: string | null }
export interface TrendBucket extends TrendMeasures { start: string; end: string; coverage: unknown }
export interface TrendView { repositoryId: string; viewId: string; mode: 'group' | 'single'; group: TrendGroup; sourceSyncIds: string[]; createdAt: string; start: string; end: string; grain: 'day' | 'week' | 'month'; timezone: string; minSample: number; hasNewSources: boolean; summary: TrendMeasures; buckets: TrendBucket[]; sources: Record<string, unknown>[]; limitations: string[] }
function measures(raw: unknown): TrendMeasures { const b = record(raw); const m = { commitCount: optionalCount(b.commitCount), scoredCount: optionalCount(b.scoredCount), unknownCount: optionalCount(b.unknownCount), highCount: optionalCount(b.highCount), highRate: b.highRate == null ? null : riskNumber(b.highRate), riskMean: b.riskMean == null ? null : riskNumber(b.riskMean), rateReason: textOrNull(b.rateReason) }; if (m.highCount != null && m.scoredCount != null && m.highCount > m.scoredCount || m.commitCount != null && m.scoredCount != null && m.unknownCount != null && m.scoredCount + m.unknownCount > m.commitCount) contractFailed('趋势计数不一致'); if (m.riskMean != null && (m.scoredCount == null || m.scoredCount < 1)) contractFailed('无已评分提交时不应提供平均风险'); return m }
export function parseTrendView(raw: unknown, id: string, viewId?: string): TrendView {
  const b = identity(raw, id)
  if (viewId && b.viewId !== viewId) contractFailed('趋势固定来源不一致')
  if (!['day', 'week', 'month'].includes(String(b.grain))) contractFailed()
  const minSample = count(b.minSample), summary = measures(b.summary), buckets = recordList(b.buckets).map(v => ({ ...measures(v), start: text(v.start), end: text(v.end), coverage: v.coverage }))
  if ([summary, ...buckets].some(m => m.highRate != null && (m.scoredCount == null || m.scoredCount < Math.max(20, minSample)))) contractFailed('小样本比例不应作为有效趋势展示')
  if (!['group', 'single'].includes(String(b.mode))) contractFailed('趋势来源模式未登记')
  return { repositoryId: id, viewId: text(b.viewId), mode: b.mode as TrendView['mode'], group: parseGroup(b.group), sourceSyncIds: textList(b.sourceSyncIds), createdAt: text(b.createdAt), start: text(b.start), end: text(b.end), grain: b.grain as TrendView['grain'], timezone: text(b.timezone), minSample, hasNewSources: flag(b.hasNewSources), summary, buckets, sources: recordList(b.sources), limitations: textList(b.limitations) }
}
export type TrendQuery = { groupId?: string; sourceSyncId?: string; start?: string; end?: string; grain?: TrendView['grain'] }
export async function createTrendView(id: string, query: TrendQuery) { return parseTrendView(await apiRequest({ path: `${root(id)}/trend-views`, method: 'POST', body: query }), id) }
export async function getTrendView(id: string, viewId: string, signal?: AbortSignal) { return parseTrendView(await apiRequest({ path: `${root(id)}/trend-views/${encodeURIComponent(viewId)}`, method: 'GET', signal }), id, viewId) }
export interface TrendCommit { commitId: string; epoch: number; risk: number | null; subject: string | null; sourceSyncId: string }
export async function trendCommits(id: string, view: TrendView, bucket: Pick<TrendBucket, 'start' | 'end'>, offset = 0, signal?: AbortSignal) {
  const query = new URLSearchParams({ start: bucket.start, end: bucket.end, limit: '50', offset: String(offset) })
  const b = identity(await apiRequest({ path: `${root(id)}/trend-views/${encodeURIComponent(view.viewId)}/commits?${query}`, method: 'GET', signal }), id)
  if (b.viewId !== view.viewId || b.offset !== offset) contractFailed('趋势下钻来源不一致')
  const commits = recordList(b.commits).map(c => ({ commitId: text(c.commitId), epoch: finiteNumber(c.epoch), risk: c.risk == null ? null : riskNumber(c.risk), subject: textOrNull(c.subject), sourceSyncId: text(c.sourceSyncId) }))
  if (commits.some(c => !view.sourceSyncIds.includes(c.sourceSyncId))) contractFailed('提交来源不在固定趋势中')
  return { commits, total: count(b.total), offset: count(b.offset), limit: count(b.limit) }
}
