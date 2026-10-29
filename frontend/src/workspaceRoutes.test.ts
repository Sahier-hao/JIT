import { expect, it } from 'vitest'
import { hashFor, parseHash, type Route } from './navigation'
it.each<Route>([
  { name: 'repositories' }, { name: 'sources' }, { name: 'repository', repositoryId: 'repo-B' },
  { name: 'my-reviews' }, { name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12 },
  { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-1', view: 'commits', commitId: 'a'.repeat(40) },
  { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-1', view: 'plan' },
  { name: 'report', runId: 'run-1', view: 'trends' }, { name: 'report', runId: 'run-1', view: 'commits' },
  { name: 'notifications' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'overview' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'prs' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'analyses' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'trends', viewId: 'frozen-view' },
  { name: 'pr-work', repositoryId: 'repo-B', owner: 'EXample', repositoryName: 'Project', number: 12, snapshotId: 'fixed-v2' },
  { name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12, snapshotId: 'fixed-v1' },
  { name: 'legacy-sync', syncId: 'analysis-1', view: 'plan' },
])('round trips the exact object %j', route => expect(parseHash(hashFor(route))).toEqual(route))
it.each(['#/models', '#/lab/models', '#/predict', '#/lab/predict', '#/predictions/batch-1', '#/lab/results/batch-1', '#/lab/demo/commits', '#/settings/connection'])('explicitly retires %s', hash => expect(parseHash(hash).name).toBe('retired'))
it('opens projects on first visit and preserves personal reviews', () => { expect(parseHash('')).toEqual({ name: 'repositories' }); expect(parseHash('#/reviews')).toEqual({ name: 'my-reviews' }) })
it('keeps old historical sources attached to the named run', () => expect(parseHash('#/lab/history/run-1/commits')).toEqual({ name: 'report', runId: 'run-1', view: 'commits' }))
it.each(['#/missing', '#/repositories/%ZZ', '#/repositories/a%2Fb'])('does not guess malformed identities %s', hash => expect(parseHash(hash).name).toBe('unknown'))
