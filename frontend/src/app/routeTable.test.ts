import { expect, it } from 'vitest'
import { hashFor, parseHash, type Route } from '@/app/navigation'
import { routeFromLocation } from '@/app/routeTable'

function locationOf(route: Route) {
  const url = hashFor(route).replace(/^#/, '')
  const [pathname, search = ''] = url.split('?')
  return { pathname, search: search ? `?${search}` : '' }
}

const CANONICAL: Route[] = [
  { name: 'landing' },
  { name: 'login', role: 'admin', next: '#/admin/models' },
  { name: 'my-reviews' },
  { name: 'my-data', view: 'builds', taskId: 'build-1' },
  { name: 'my-data', view: 'builds', buildProjectId: 'repo-a' },
  { name: 'my-data', view: 'builds', buildProjectId: 'repo-a', taskId: 'build-1' },
  { name: 'admin', view: 'evaluation' },
  { name: 'my-data', datasetVersion: 'shared data+1' },
  { name: 'my-training', historyDatasetVersion: 'shared data+1' },
  { name: 'my-training', experimentId: 'experiment-1', historyDatasetVersion: 'shared data+1' },
  { name: 'my-training', datasetVersion: 'data-1' },
  { name: 'my-training', experimentId: 'experiment-1' },
  { name: 'my-training', method: 'mlp-v1' },
  { name: 'algorithms' },
  { name: 'algorithms', method: 'mlp-v1' },
  { name: 'ide-plugin' },
  { name: 'my-models' },
  { name: 'my-predictions' },
  { name: 'my-predictions', datasetVersion: 'data-1' },
  { name: 'my-predictions', batchId: 'batch-1' },
  { name: 'model-evaluation' },
  { name: 'model-evaluation', source: 'training', experimentId: 'experiment-1', taskId: 'task-1', modelId: 'model-1' },
  { name: 'model-evaluation', source: 'prediction', batchId: 'batch-1' },
  { name: 'my-evaluation' },
  { name: 'my-evaluation', batchId: 'batch-1', modelId: 'model-1', datasetVersion: 'data-1', partition: 'test', splitPreset: 'temporal-70-15-15' },
  { name: 'profile' },
  { name: 'research-line' },
  { name: 'notifications' },
  { name: 'repositories' },
  { name: 'sources' },
  { name: 'repository', repositoryId: 'repo-a' },
  { name: 'repository', repositoryId: 'repo-a', buildTaskId: 'build-1' },
  { name: 'repository', repositoryId: 'repo-a', tab: 'overview' },
  { name: 'repository', repositoryId: 'repo-a', tab: 'prs' },
  { name: 'repository', repositoryId: 'repo-a', tab: 'analyses' },
  { name: 'repository', repositoryId: 'repo-a', tab: 'trends', viewId: 'view-1' },
  { name: 'comparison', repositoryId: 'repo-a', baseSyncId: 'base', targetSyncId: 'target' },
  { name: 'analysis', repositoryId: 'repo-a', viewSyncId: 'sync-a', view: 'commits' },
  { name: 'analysis', repositoryId: 'repo-a', viewSyncId: 'sync-a', view: 'commits', commitId: 'a'.repeat(40) },
  { name: 'analysis', repositoryId: 'repo-a', viewSyncId: 'sync-a', view: 'plan' },
  { name: 'pr-work', repositoryId: 'repo-a', owner: 'owner', repositoryName: 'repo', number: 12, snapshotId: 'snap-1' },
  { name: 'pr-work', owner: 'owner', repositoryName: 'repo', number: 12, mode: 'preview' },
  { name: 'legacy-sync', syncId: 'sync-a', view: 'plan' },
  { name: 'admin', view: 'models' },
  { name: 'admin', view: 'models', resourceId: 'model-1' },
  { name: 'admin', view: 'models', selectedModelId: 'model-2' },
  { name: 'admin', view: 'datasets', resourceId: 'dataset-1', version: 'version-1' },
  { name: 'admin', view: 'training', resourceId: 'task-1' },
  { name: 'admin', view: 'training-experiment', resourceId: 'experiment-1' },
  { name: 'admin', view: 'comparisons', models: ['model-a', 'model-b'] },
  { name: 'admin', view: 'experiments' },
  { name: 'admin', view: 'experiments', resourceId: 'report-1' },
  { name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', compatibility: 'repository-analysis', artifactState: 'complete', offset: 20 },
  { name: 'admin', view: 'experiment-runs', resourceId: 'candidate-1' },
  { name: 'admin', view: 'experiment-runs', resourceId: 'run-20', registrationState: 'unregistered', offset: 20 },
  { name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', offset: 20, focusCandidateId: 'run-20' },
  { name: 'report', runId: 'run-1', view: 'trends' },
]

it.each(CANONICAL)('matches the canonical route %j', route => {
  expect(routeFromLocation(locationOf(route))).toEqual(route)
})

it.each(['#/repositories', '#/connect', '#/sources', '#/reports', '#/validation', '#/trends', '#/lab/history/run-1/commits', '#/models'])(
  'leaves compatibility address %s to parseHash',
  hash => {
    const url = hash.replace(/^#/, '')
    const [pathname, search = ''] = url.split('?')
    expect(routeFromLocation({ pathname, search: search ? `?${search}` : '' })).toBeNull()
    expect(parseHash(hash).name).not.toBe('unknown')
  },
)

it('falls back for an address that is neither canonical nor known', () => {
  expect(routeFromLocation({ pathname: '/missing', search: '' })).toBeNull()
  expect(parseHash('#/missing')).toEqual({ name: 'unknown', hash: '#/missing' })
})
