import { expect, it } from 'vitest'
import { projectsNavActive } from '@/components/layout/navActive'
import type { Route } from '@/app/navigation'

const highlighted: Route[] = [
  { name: 'repositories' },
  { name: 'sources' },
  { name: 'repository', repositoryId: 'repo-a' },
  { name: 'analysis', repositoryId: 'repo-a', viewSyncId: 'sync-a', view: 'commits' },
  { name: 'comparison', repositoryId: 'repo-a', baseSyncId: 'sync-a', targetSyncId: 'sync-b' },
  { name: 'pr-work', repositoryId: 'repo-a', owner: 'o', repositoryName: 'r', number: 1 },
]

const quiet: Route[] = [
  { name: 'landing' },
  { name: 'login' },
  { name: 'my-data' },
  { name: 'my-training' },
  { name: 'algorithms' },
  { name: 'my-models' },
  { name: 'my-reviews' },
  { name: 'profile' },
  { name: 'notifications' },
  { name: 'research-line' },
  { name: 'pr-work', owner: 'o', repositoryName: 'r', number: 1 },
  { name: 'legacy-sync', syncId: 'sync-a', view: 'commits' },
  { name: 'retired', hash: '#/models' },
  { name: 'unknown', hash: '#/missing' },
]

it.each(highlighted)('keeps project navigation active on %j', route => {
  expect(projectsNavActive(route)).toBe(true)
})

it.each(quiet)('does not highlight project navigation on %j', route => {
  expect(projectsNavActive(route)).toBe(false)
})
