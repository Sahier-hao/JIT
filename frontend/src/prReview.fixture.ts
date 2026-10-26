import type { PRSnapshot } from './prReviewClient'

export function snapshot(id = 'v1', sha = 'b'.repeat(40)): PRSnapshot {
  return { snapshotId: id, repositoryId: 'repo', owner: 'example', name: 'project', number: 12, title: 'Reset token', author: 'author', url: 'https://github.com/example/project/pull/12', body: 'Add expiry handling', remoteState: 'open', updatedAt: '2026-10-26T00:00:00Z', capturedAt: '2026-10-26T01:00:00Z', baseSha: 'a'.repeat(40), headSha: sha, baseBranch: 'main', headBranch: 'feature', baseRepository: 'example/project', headRepository: 'example/project', filesComplete: true, totalFiles: 2, commitsComplete: true, totalCommits: 1, commits: [{ sha, message: 'handle expiry' }], files: [
    { path: 'src/token.py', previousPath: null, blobSha: 'c'.repeat(40), status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new', patchComplete: true },
    { path: 'tests/token.py', previousPath: null, blobSha: 'd'.repeat(40), status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+test', patchComplete: true },
  ] }
}
