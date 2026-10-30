import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, text, textOrNull, utcTimestamp } from './apiContract'

export interface UpdateState {
  repositoryId: string; enabled: boolean; branch: string; intervalSeconds: number
  status: 'idle' | 'checking' | 'analyzing' | 'updated' | 'up-to-date' | 'error'
  lastAttemptAt: string | null; lastCheckedAt: string | null; nextCheckAt: string | null
  remoteHead: string | null; resolvedBranch: string | null; errorCode: string | null
}
export function parseUpdateState(raw: unknown, repositoryId: string): UpdateState {
  const body = record(raw)
  if (body.repositoryId !== repositoryId) contractFailed('仓库提醒来源不一致')
  const status = text(body.status) as UpdateState['status']
  if (!['idle', 'checking', 'analyzing', 'updated', 'up-to-date', 'error'].includes(status)) contractFailed()
  const timestamp = (key: string) => body[key] === null ? null : utcTimestamp(body[key])
  const intervalSeconds = finiteNumber(body.intervalSeconds)
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 86400) contractFailed()
  return { repositoryId, enabled: flag(body.enabled), branch: text(body.branch), intervalSeconds, status,
    lastAttemptAt: timestamp('lastAttemptAt'), lastCheckedAt: timestamp('lastCheckedAt'), nextCheckAt: timestamp('nextCheckAt'),
    remoteHead: textOrNull(body.remoteHead), resolvedBranch: textOrNull(body.resolvedBranch), errorCode: textOrNull(body.errorCode) }
}
export function updateRepository(repositoryId: string, action: 'read' | 'refresh' | 'configure', body?: { enabled?: boolean; branch?: string; intervalSeconds?: number }, signal?: AbortSignal): Promise<UpdateState> {
  return apiRequest({ path: `/api/v1/repositories/${encodeURIComponent(repositoryId)}/${action === 'refresh' ? 'refresh' : 'updates'}`,
    method: action === 'read' ? 'GET' : action === 'refresh' ? 'POST' : 'PATCH', body, signal })
    .then(raw => parseUpdateState(raw, repositoryId))
}
