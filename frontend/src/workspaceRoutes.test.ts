import { describe, expect, it } from 'vitest'
import { hashFor, parseHash, legacyParameterError, type Route } from './navigation'

describe('product spaces and object identities', () => {
  const routes: Route[] = [
    { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-A', view: 'commits' },
    { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-A', view: 'plan' },
    { name: 'analysis', repositoryId: 'repo-B', viewSyncId: 'analysis-A', view: 'commits', commitId: 'a'.repeat(40) },
    { name: 'history', runId: 'run-A', view: 'trends' },
    { name: 'history', runId: 'run-A', view: 'commits' },
    { name: 'demo' },
    { name: 'legacy-sync', syncId: 'sync-A', view: 'commits' },
    { name: 'settings', page: 'connection', returnTo: '#/repositories/repo-B' },
  ]
  it.each(routes)('round trips $name', route => expect(parseHash(hashFor(route))).toEqual(route))
  it('opens the project entrance without choosing a repository', () => {
    expect(hashFor(parseHash(''))).toBe('#/projects')
  })
  it.each(['#/%E0%A4%A', '#/repositories/%FF', '#/lab/history//commits', '#/repositories/a/analyses/b/plan/c'])('rejects malformed %s without throwing', hash => {
    expect(parseHash(hash).name).toBe('unknown')
  })
  it('canonicalizes model and saved result aliases without dropping identity', () => {
    expect(hashFor(parseHash('#/predictions/saved-B'))).toBe('#/lab/results/saved-B')
    expect(hashFor(parseHash('#/models'))).toBe('#/lab/models')
  })
  it.each(['?mode=demo&sync=sync-A', '?mode=invalid', '?mode=demo&mode=repository', '?sync=A&sync=B'])('explains conflicting legacy parameters %s', search => {
    expect(legacyParameterError(search, { name: 'workbench' })).not.toBe('')
  })
})
