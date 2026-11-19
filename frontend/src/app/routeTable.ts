import { matchRoutes, type RouteObject } from 'react-router-dom'
import type { Route } from '@/app/navigation'

type Params = Record<string, string | undefined>
type Build = (params: Params, query: URLSearchParams) => Route

const build = (parameters: Build) => ({ build: parameters })

function text(value: string | null | undefined): string | undefined {
  return value ? value : undefined
}

function loginRoute(query: URLSearchParams): Route {
  const role = query.get('role') === 'admin' ? 'admin' as const : query.get('role') === 'user' ? 'user' as const : undefined
  const next = text(query.get('next'))
  return { name: 'login', ...(role ? { role } : {}), ...(next ? { next } : {}) }
}

function myDataRoute(query: URLSearchParams): Route {
  const view = query.get('view') === 'builds' ? 'builds' as const : undefined
  const taskId = text(query.get('taskId'))
  return { name: 'my-data', ...(view ? { view } : {}), ...(taskId ? { taskId } : {}) }
}

function prWorkRoute(params: Params, query: URLSearchParams): Route {
  const snapshotId = text(query.get('snapshotId'))
  const mode = query.get('mode') === 'preview' ? 'preview' as const : undefined
  return {
    name: 'pr-work',
    ...(params.repositoryId ? { repositoryId: params.repositoryId } : {}),
    owner: params.owner ?? '',
    repositoryName: params.repositoryName ?? '',
    number: Number(params.number),
    ...(snapshotId ? { snapshotId } : {}),
    ...(mode ? { mode } : {}),
  }
}

function repositoryRoot(params: Params, query: URLSearchParams): Route {
  const buildTaskId = text(query.get('buildTaskId'))
  return { name: 'repository', repositoryId: params.repositoryId ?? '', ...(buildTaskId ? { buildTaskId } : {}) }
}

function adminComparisons(query: URLSearchParams): Route {
  const models = (query.get('models') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return { name: 'admin', view: 'comparisons', ...(models.length ? { models } : {}) }
}

function adminExperimentRuns(params: Params, query: URLSearchParams): Route {
  const offset = Number(query.get('offset'))
  return {
    name: 'admin', view: 'experiment-runs',
    ...(params.candidateId ? { resourceId: params.candidateId } : {}),
    ...(['registered', 'unregistered'].includes(query.get('registrationState') ?? '')
      ? { registrationState: query.get('registrationState') as 'registered' | 'unregistered' } : {}),
    ...(['repository-analysis', 'offline-only', 'input-unsupported', 'schema-incompatible'].includes(query.get('compatibility') ?? '')
      ? { compatibility: query.get('compatibility') as 'repository-analysis' | 'offline-only' | 'input-unsupported' | 'schema-incompatible' } : {}),
    ...(['complete', 'invalid', 'failed'].includes(query.get('artifactState') ?? '')
      ? { artifactState: query.get('artifactState') as 'complete' | 'invalid' | 'failed' } : {}),
    ...(Number.isFinite(offset) && offset > 0 ? { offset: Math.floor(offset) } : {}),
  }
}

function reportRoute(params: Params): Route {
  const view = params.view === 'commits' || params.view === 'trends' ? params.view : 'overview'
  return { name: 'report', runId: params.runId, view }
}

/**
 * Canonical path table. The router matches these paths; legacy aliases and
 * unknown/retired addresses fall through to `parseHash` so bookmarks keep working.
 */
export const ROUTES: RouteObject[] = [
  { path: '/', handle: build(() => ({ name: 'landing' })) },
  { path: '/welcome', handle: build(() => ({ name: 'landing' })) },
  { path: '/login', handle: build((_params, query) => loginRoute(query)) },
  { path: '/reviews', handle: build(() => ({ name: 'my-reviews' })) },
  { path: '/reviews/:owner/:repositoryName/:number', handle: build(prWorkRoute) },
  { path: '/my-data', handle: build((_params, query) => myDataRoute(query)) },
  { path: '/my-training', handle: build((_params, query) => {
    const datasetVersion = text(query.get('datasetVersion'))
    return { name: 'my-training', ...(datasetVersion ? { datasetVersion } : {}) }
  }) },
  { path: '/my-training/:experimentId', handle: build(params => ({ name: 'my-training', experimentId: params.experimentId })) },
  { path: '/my-models', handle: build(() => ({ name: 'my-models' })) },
  { path: '/profile', handle: build(() => ({ name: 'profile' })) },
  { path: '/research/line-model', handle: build(() => ({ name: 'research-line' })) },
  { path: '/notifications', handle: build(() => ({ name: 'notifications' })) },
  { path: '/projects', handle: build(() => ({ name: 'repositories' })) },
  { path: '/projects/new', handle: build(() => ({ name: 'sources' })) },
  { path: '/projects/:repositoryId', handle: build(repositoryRoot) },
  { path: '/projects/:repositoryId/overview', handle: build(params => ({ name: 'repository', repositoryId: params.repositoryId ?? '', tab: 'overview' })) },
  { path: '/projects/:repositoryId/prs', handle: build(params => ({ name: 'repository', repositoryId: params.repositoryId ?? '', tab: 'prs' })) },
  { path: '/projects/:repositoryId/analyses', handle: build(params => ({ name: 'repository', repositoryId: params.repositoryId ?? '', tab: 'analyses' })) },
  { path: '/projects/:repositoryId/trends', handle: build(params => ({ name: 'repository', repositoryId: params.repositoryId ?? '', tab: 'trends' })) },
  { path: '/projects/:repositoryId/trends/:viewId', handle: build(params => ({ name: 'repository', repositoryId: params.repositoryId ?? '', tab: 'trends', viewId: params.viewId })) },
  { path: '/projects/:repositoryId/compare/:baseSyncId/:targetSyncId', handle: build(params => ({
    name: 'comparison', repositoryId: params.repositoryId ?? '', baseSyncId: params.baseSyncId ?? '', targetSyncId: params.targetSyncId ?? '',
  })) },
  { path: '/projects/:repositoryId/analyses/:viewSyncId/commits', handle: build(params => ({
    name: 'analysis', repositoryId: params.repositoryId ?? '', viewSyncId: params.viewSyncId ?? '', view: 'commits',
  })) },
  { path: '/projects/:repositoryId/analyses/:viewSyncId/commits/:commitId', handle: build(params => ({
    name: 'analysis', repositoryId: params.repositoryId ?? '', viewSyncId: params.viewSyncId ?? '', view: 'commits', commitId: params.commitId ?? '',
  })) },
  { path: '/projects/:repositoryId/analyses/:viewSyncId/plan', handle: build(params => ({
    name: 'analysis', repositoryId: params.repositoryId ?? '', viewSyncId: params.viewSyncId ?? '', view: 'plan',
  })) },
  { path: '/projects/:repositoryId/analyses/:viewSyncId/plan/:commitId', handle: build(params => ({
    name: 'analysis', repositoryId: params.repositoryId ?? '', viewSyncId: params.viewSyncId ?? '', view: 'plan', commitId: params.commitId ?? '',
  })) },
  { path: '/projects/:repositoryId/prs/:owner/:repositoryName/:number', handle: build(prWorkRoute) },
  { path: '/legacy/sync/:syncId/:view', handle: build(params => ({
    name: 'legacy-sync', syncId: params.syncId ?? '', view: params.view === 'plan' ? 'plan' : 'commits',
  })) },
  { path: '/admin', handle: build(() => ({ name: 'admin', view: 'models' })) },
  { path: '/admin/models', handle: build(() => ({ name: 'admin', view: 'models' })) },
  { path: '/admin/models/:modelId', handle: build(params => ({ name: 'admin', view: 'models', resourceId: params.modelId })) },
  { path: '/admin/datasets', handle: build(() => ({ name: 'admin', view: 'datasets' })) },
  { path: '/admin/datasets/:name', handle: build(params => ({ name: 'admin', view: 'datasets', resourceId: params.name })) },
  { path: '/admin/datasets/:name/:version', handle: build(params => ({ name: 'admin', view: 'datasets', resourceId: params.name ?? '', version: params.version })) },
  { path: '/admin/training', handle: build(() => ({ name: 'admin', view: 'training' })) },
  { path: '/admin/training/:taskId', handle: build(params => ({ name: 'admin', view: 'training', resourceId: params.taskId })) },
  { path: '/admin/training-experiment/:experimentId', handle: build(params => ({ name: 'admin', view: 'training-experiment', resourceId: params.experimentId })) },
  { path: '/admin/comparisons', handle: build((_params, query) => adminComparisons(query)) },
  { path: '/admin/experiments', handle: build(() => ({ name: 'admin', view: 'experiments' })) },
  { path: '/admin/experiments/:reportId', handle: build(params => ({ name: 'admin', view: 'experiments', resourceId: params.reportId })) },
  { path: '/admin/experiment-runs', handle: build((_params, query) => adminExperimentRuns({}, query)) },
  { path: '/admin/experiment-runs/:candidateId', handle: build(adminExperimentRuns) },
  { path: '/admin/reports', handle: build(() => ({ name: 'report', view: 'overview' })) },
  { path: '/admin/reports/:runId/:view', handle: build(reportRoute) },
  { path: '*', handle: build(() => ({ name: 'unknown', hash: '' })) },
]

export function routeFromLocation(location: { pathname: string; search: string }): Route | null {
  const matches = matchRoutes(ROUTES, location)
  const match = matches?.[matches.length - 1]
  const handler = match?.route.handle as { build?: Build } | undefined
  if (!match || !handler?.build) return null
  const route = handler.build(match.params, new URLSearchParams(location.search))
  // The catch-all is a marker: let `parseHash` classify retired and unknown addresses.
  return route.name === 'unknown' ? null : route
}
