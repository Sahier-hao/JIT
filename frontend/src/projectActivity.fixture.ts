import type { ProjectEvent, TrendView } from './projectActivityClient'
export const PROJECT = '11111111-1111-4111-8111-111111111111'
export const NOW = '2026-10-29T00:00:00Z'
export const GROUP = { groupId: 'g1', branch: 'main', modelId: 'model-original', runId: 'run-original', featureSchemaVersion: 'jit-v1', distributionRule: 'repo-distribution-v1', sourceSyncIds: ['s1', 's2'] }
export const modelChoices = [
  { modelId: 'model-original', name: '原固定模型', method: 'lr', state: 'ready', enabled: true, repositoryPredictionSupported: true, isDefault: false },
  { modelId: 'model-new', name: '新默认模型', method: 'lr', state: 'ready', enabled: true, repositoryPredictionSupported: true, isDefault: true },
  { modelId: 'model-disabled', name: '停用模型', method: 'lr', state: 'ready', enabled: false, repositoryPredictionSupported: true, isDefault: false },
]
export function prPage(overrides: Record<string, unknown> = {}) { return { repositoryId: PROJECT, supported: true, owner: 'example', name: 'project', pullRequests: [{ number: 12, title: '修复边界', author: 'author', url: 'https://github.com/example/project/pull/12', updatedAt: NOW, remoteState: 'open', draft: false, snapshotId: 'v1', analysisStatus: 'completed', modelId: 'model-original', syncId: 's1' }], page: 1, hasMore: false, checkedAt: NOW, ...overrides } }
export function tracking(overrides: Record<string, unknown> = {}) { return { repositoryId: PROJECT, supported: true, enabled: false, modelId: 'model-original', intervalSeconds: 300, status: 'paused', lastCheckedAt: null, nextCheckAt: null, errorCode: null, ...overrides } }
export function trendView(overrides: Partial<TrendView> = {}): TrendView { return { repositoryId: PROJECT, viewId: 'view-fixed', mode: 'group', group: GROUP, sourceSyncIds: ['s1', 's2'], createdAt: NOW, start: '2026-10-01', end: '2026-10-29', grain: 'week', timezone: 'UTC+08:00', minSample: 20, hasNewSources: false,
  summary: { commitCount: 30, scoredCount: 26, unknownCount: 4, highCount: 4, highRate: 4 / 26, riskMean: .37, rateReason: null },
  buckets: [
    { start: '2026-10-01', end: '2026-10-08', commitCount: 24, scoredCount: 22, unknownCount: 2, highCount: 3, highRate: 3 / 22, riskMean: .42, rateReason: null, coverage: 'observed' },
    { start: '2026-10-08', end: '2026-10-15', commitCount: null, scoredCount: null, unknownCount: null, highCount: null, highRate: null, riskMean: null, rateReason: '未证明覆盖', coverage: 'unknown' },
    { start: '2026-10-15', end: '2026-10-29', commitCount: 6, scoredCount: 4, unknownCount: 2, highCount: 1, highRate: null, riskMean: .55, rateReason: '已评分样本不足 20', coverage: 'observed' },
  ], sources: [{ syncId: 's1', datasetVersion: 'data-1' }, { syncId: 's2', datasetVersion: 'data-2' }], limitations: ['仅代表已保存观测'], ...overrides } }
export function event(overrides: Partial<ProjectEvent> = {}): ProjectEvent { return { eventId: 'event-1', repositoryId: PROJECT, kind: 'analysis-ready', createdAt: NOW, number: 12, snapshotId: 'v2', syncId: 's2', modelId: 'model-original', title: '新版本分析就绪', message: '固定版本结果可供核对，未知分数不计为低风险。', owner: 'example', name: 'project', ...overrides } }
export const response = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
