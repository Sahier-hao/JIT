import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, text, textOrNull } from './apiContract'

export interface PRItem { number: number; title: string; author: string; url: string; updatedAt: string; remoteState: 'open' | 'closed' | 'merged' }
export interface PRFile { path: string; previousPath: string | null; blobSha: string; status: string; additions: number; deletions: number; patch: string | null; patchComplete: boolean }
export interface PRSnapshot extends PRItem {
  snapshotId: string; repositoryId: string; owner: string; name: string; body: string; baseSha: string; headSha: string
  baseBranch: string; headBranch: string; baseRepository: string; headRepository: string | null; capturedAt: string
  files: PRFile[]; totalFiles: number; filesComplete: boolean; commits: { sha: string; message: string }[]; totalCommits: number; commitsComplete: boolean
  previousSnapshotId?: string | null; historyRelation?: string
}
export interface PRPrepared { snapshot: PRSnapshot; checkedAt: string; remoteState: PRItem['remoteState'] }
export interface PRList { owner: string; name: string; repositoryId: string; repositoryUrl: string; pullRequests: PRItem[]; page: number; hasMore: boolean; checkedAt: string; state: string }
export interface PRContext { snapshotId: string; path: string; side: 'base' | 'head'; ref: string; content: string; complete: boolean; absent: boolean; totalLines: number }
const string = (v: unknown) => typeof v === 'string' ? v : contractFailed()
const integer = (v: unknown) => { const n = finiteNumber(v); if (!Number.isSafeInteger(n) || n < 0) contractFailed(); return n }
export function parseItem(raw: unknown): PRItem {
  const b = record(raw), state = text(b.remoteState)
  if (!['open', 'closed', 'merged'].includes(state)) contractFailed()
  return { number: integer(b.number), title: string(b.title), author: text(b.author), url: text(b.url), updatedAt: text(b.updatedAt), remoteState: state as PRItem['remoteState'] }
}
export function parseSnapshot(raw: unknown): PRSnapshot {
  const b = record(raw)
  if (b.url !== `https://github.com/${b.owner}/${b.name}/pull/${b.number}`) contractFailed('PR 地址与来源不一致')
  return { ...parseItem(b), snapshotId: text(b.snapshotId), repositoryId: text(b.repositoryId), owner: text(b.owner), name: text(b.name), body: string(b.body),
    baseSha: text(b.baseSha), headSha: text(b.headSha), baseBranch: text(b.baseBranch), headBranch: text(b.headBranch), baseRepository: text(b.baseRepository), headRepository: textOrNull(b.headRepository), capturedAt: text(b.capturedAt),
    totalFiles: integer(b.totalFiles), filesComplete: flag(b.filesComplete), totalCommits: integer(b.totalCommits), commitsComplete: flag(b.commitsComplete),
    previousSnapshotId: textOrNull(b.previousSnapshotId), historyRelation: b.historyRelation === undefined ? 'unknown' : text(b.historyRelation),
    commits: recordList(b.commits).map(c => ({ sha: text(c.sha), message: string(c.message) })),
    files: recordList(b.files).map(f => ({ path: text(f.path), previousPath: textOrNull(f.previousPath), blobSha: text(f.blobSha), status: text(f.status), additions: integer(f.additions), deletions: integer(f.deletions), patch: textOrNull(f.patch), patchComplete: flag(f.patchComplete) })) }
}
export function prepared(raw: unknown): PRPrepared {
  const b = record(raw), snapshot = parseSnapshot(b.snapshot)
  const state = text(b.remoteState)
  if (!['open', 'closed', 'merged'].includes(state)) contractFailed()
  return { snapshot, checkedAt: text(b.checkedAt), remoteState: state as PRItem['remoteState'] }
}
export async function intakePR(url: string, state = 'open', page = 1): Promise<PRList | PRPrepared> {
  const raw = record(await apiRequest({ path: '/api/v1/review-sources', method: 'POST', body: { url: url.trim(), state, page } }))
  if (raw.snapshot) return prepared(raw)
  return { owner: text(raw.owner), name: text(raw.name), repositoryId: text(raw.repositoryId), repositoryUrl: text(raw.repositoryUrl), pullRequests: recordList(raw.pullRequests).map(parseItem), page: integer(raw.page), hasMore: flag(raw.hasMore), checkedAt: text(raw.checkedAt), state: text(raw.state) }
}
export async function refreshPR(owner: string, name: string, number: number, repositoryId?: string): Promise<PRPrepared> {
  const result = prepared(await apiRequest({ path: `/api/v1/pr-sources/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${number}/refresh`, method: 'POST', ...(repositoryId ? { body: { repositoryId } } : {}) }))
  if (repositoryId && result.snapshot.repositoryId !== repositoryId) contractFailed('PR 基项目与当前项目不一致')
  if (result.snapshot.owner.toLowerCase() !== owner.toLowerCase() || result.snapshot.name.toLowerCase() !== name.toLowerCase() || result.snapshot.number !== number) contractFailed('PR 来源不一致')
  return result
}
export async function getPRSnapshot(snapshotId: string, signal?: AbortSignal): Promise<PRSnapshot> {
  const source = parseSnapshot(await apiRequest({ path: `/api/v1/pr-snapshots/${encodeURIComponent(snapshotId)}`, method: 'GET', signal }))
  if (source.snapshotId !== snapshotId) contractFailed('PR 版本不一致')
  return source
}
export function samePRSource(a: PRSnapshot, b: PRSnapshot): boolean {
  return a.snapshotId === b.snapshotId && a.owner === b.owner && a.name === b.name && a.number === b.number && a.headSha === b.headSha && a.baseSha === b.baseSha && a.repositoryId === b.repositoryId
    && JSON.stringify(a.files.map(f => [f.path, f.blobSha, f.status])) === JSON.stringify(b.files.map(f => [f.path, f.blobSha, f.status]))
}
export async function verifyBackupSources(work: { rounds: Record<string, { source: PRSnapshot }> }): Promise<void> {
  for (const round of Object.values(work.rounds)) {
    if (!samePRSource(round.source, await getPRSnapshot(round.source.snapshotId))) contractFailed('备份的代码来源与保存版本不一致，未恢复任何内容')
  }
}
export async function getPRContext(source: PRSnapshot, path: string, side: 'base' | 'head', signal?: AbortSignal): Promise<PRContext> {
  const b = record(await apiRequest({ path: `/api/v1/pr-snapshots/${encodeURIComponent(source.snapshotId)}/context?path=${encodeURIComponent(path)}&side=${side}`, method: 'GET', signal }))
  if (b.snapshotId !== source.snapshotId || b.path !== path || b.side !== side || b.ref !== source[side === 'head' ? 'headSha' : 'baseSha']) contractFailed('代码上下文来源不一致')
  return { snapshotId: source.snapshotId, path, side, ref: text(b.ref), content: string(b.content), complete: flag(b.complete), absent: flag(b.absent), totalLines: integer(b.totalLines) }
}
