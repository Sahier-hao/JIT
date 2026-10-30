import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, text, textList, textOrNull } from './apiContract'

export interface RepositoryOverviewMetadata {
  fullName: string; description: string | null; defaultBranch: string | null; private: boolean
  stars: number; forks: number; openIssues: number; watchers: number
  pushedAt: string | null; createdAt: string | null; topics: string[]; license: string | null
  homepage: string | null; htmlUrl: string
}
export interface RepositoryOverviewLanguage { name: string; bytes: number; percent: number }
export interface RepositoryOverviewActivity { weekStart: string; commits: number }
export interface RepositoryOverviewCommit { sha: string; message: string; author: string; date: string; url: string }
export interface RepositoryOverview {
  repositoryId: string; supported: boolean; url: string; displayName: string
  metadata: RepositoryOverviewMetadata | null; languages: RepositoryOverviewLanguage[]
  activity: RepositoryOverviewActivity[]; activityCoverage: string | null
  recentCommits: RepositoryOverviewCommit[]; fetchedAt: string | null
  errorCode: string | null; stale: boolean; retryAfter: number | null
}

function integer(raw: unknown) {
  const value = finiteNumber(raw)
  if (!Number.isInteger(value) || value < 0) contractFailed()
  return value
}

export function parseOverview(raw: unknown, repositoryId: string): RepositoryOverview {
  const body = record(raw)
  if (body.repositoryId !== repositoryId) contractFailed('仓库概览来源不一致')
  const metadata = body.metadata === null || body.metadata === undefined ? null : (() => {
    const item = record(body.metadata)
    return { fullName: text(item.fullName), description: textOrNull(item.description), defaultBranch: textOrNull(item.defaultBranch),
      private: flag(item.private), stars: integer(item.stars), forks: integer(item.forks), openIssues: integer(item.openIssues),
      watchers: integer(item.watchers), pushedAt: textOrNull(item.pushedAt), createdAt: textOrNull(item.createdAt),
      topics: textList(item.topics), license: textOrNull(item.license), homepage: textOrNull(item.homepage), htmlUrl: text(item.htmlUrl) }
  })()
  return {
    repositoryId,
    supported: flag(body.supported),
    url: text(body.url),
    displayName: text(body.displayName),
    metadata,
    languages: recordList(body.languages).map(item => ({ name: text(item.name), bytes: integer(item.bytes), percent: finiteNumber(item.percent) })),
    activity: recordList(body.activity).map(item => ({ weekStart: text(item.weekStart), commits: integer(item.commits) })),
    activityCoverage: textOrNull(body.activityCoverage),
    recentCommits: recordList(body.recentCommits).map(item => ({ sha: text(item.sha), message: text(item.message), author: text(item.author), date: text(item.date), url: text(item.url) })),
    fetchedAt: textOrNull(body.fetchedAt),
    errorCode: textOrNull(body.errorCode),
    stale: flag(body.stale),
    retryAfter: body.retryAfter === null || body.retryAfter === undefined ? null : finiteNumber(body.retryAfter),
  }
}

export function getRepositoryOverview(repositoryId: string, refresh = false, signal?: AbortSignal): Promise<RepositoryOverview> {
  const suffix = refresh ? '?refresh=true' : ''
  return apiRequest({ path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/overview${suffix}`, method: 'GET', signal })
    .then(raw => parseOverview(raw, repositoryId))
}
