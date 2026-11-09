import { expect, it } from 'vitest'
import { analysisRoute, hashFor, parseHash, repositoryRoute, type Route } from './navigation'
it.each<Route>([
  { name: 'landing' },
  { name: 'login', role: 'admin', next: '#/admin/models' },
  { name: 'repositories' }, { name: 'sources' }, { name: 'repository', repositoryId: 'repo-B' },
  { name: 'my-reviews' }, { name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12 },
  { name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12, mode: 'preview' },
  { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-1', view: 'commits', commitId: 'a'.repeat(40) },
  { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-1', view: 'plan' },
  { name: 'report', runId: 'run-1', view: 'trends' }, { name: 'report', runId: 'run-1', view: 'commits' },
  { name: 'notifications' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'overview' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'prs' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'analyses' },
  { name: 'repository', repositoryId: 'repo-B', tab: 'trends', viewId: 'frozen-view' },
  { name: 'pr-work', repositoryId: 'repo-B', owner: 'EXample', repositoryName: 'Project', number: 12, snapshotId: 'fixed-v2' },
  { name: 'pr-work', repositoryId: 'repo-B', owner: 'example', repositoryName: 'project', number: 12, mode: 'preview' },
  { name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12, snapshotId: 'fixed-v1' },
  { name: 'legacy-sync', syncId: 'analysis-1', view: 'plan' },
  { name: 'admin', view: 'models' },
  { name: 'admin', view: 'models', resourceId: '11111111-1111-4111-8111-111111111111' },
  { name: 'admin', view: 'datasets', resourceId: 'mp-scikit-learn', version: 'mp-scikit-learn-2022-01-02_2024-12-30' },
  { name: 'admin', view: 'training', resourceId: '22222222-2222-4222-8222-222222222222' },
  { name: 'admin', view: 'comparisons', models: ['model-a', 'model-b'] },
  { name: 'admin', view: 'experiments' },
  { name: 'admin', view: 'experiments', resourceId: 'abc123def456' },
  { name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', compatibility: 'repository-analysis', artifactState: 'complete', offset: 20 },
  { name: 'admin', view: 'experiment-runs', resourceId: 'a'.repeat(64) },
  { name: 'admin', view: 'training-experiment', resourceId: '11111111-1111-4111-8111-111111111111' },
])('round trips the exact object %j', route => expect(parseHash(hashFor(route))).toEqual(route))
it.each(['#/models', '#/lab/models', '#/predict', '#/lab/predict', '#/predictions/batch-1', '#/lab/results/batch-1', '#/lab/demo/commits', '#/settings/connection'])('explicitly retires %s', hash => expect(parseHash(hash).name).toBe('retired'))
it('opens the product landing first and keeps projects and reviews', () => { expect(parseHash('')).toEqual({ name: 'landing' }); expect(parseHash('#/projects')).toEqual({ name: 'repositories' }); expect(parseHash('#/reviews')).toEqual({ name: 'my-reviews' }) })
it('keeps old historical sources attached to the named run', () => expect(parseHash('#/lab/history/run-1/commits')).toEqual({ name: 'report', runId: 'run-1', view: 'commits' }))
it.each(['#/missing', '#/repositories/%ZZ', '#/repositories/a%2Fb'])('does not guess malformed identities %s', hash => expect(parseHash(hash).name).toBe('unknown'))
it('builds analysis routes with optional commit and plan view', () => {
  expect(analysisRoute('repo-B', 'analysis-1')).toEqual({ name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-1', view: 'commits' })
  expect(analysisRoute('repo-B', 'analysis-1', { commitId: 'a'.repeat(40) })).toMatchObject({ commitId: 'a'.repeat(40), view: 'commits' })
  expect(analysisRoute('repo-B', 'analysis-1', { view: 'plan' })).toMatchObject({ view: 'plan' })
})
it('builds repository routes with tab and frozen trend view', () => {
  expect(repositoryRoute('repo-B')).toEqual({ name: 'repository', repositoryId: 'repo-B' })
  expect(repositoryRoute('repo-B', 'prs')).toEqual({ name: 'repository', repositoryId: 'repo-B', tab: 'prs' })
  expect(repositoryRoute('repo-B', 'trends', 'frozen-view')).toEqual({ name: 'repository', repositoryId: 'repo-B', tab: 'trends', viewId: 'frozen-view' })
})
