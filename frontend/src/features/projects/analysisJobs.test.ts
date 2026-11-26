import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  forgetAnalysisJobs, hasTrackedAnalysisJob, trackAnalysisJob, trackedAnalysisJobs,
} from '@/features/projects/analysisJobs'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

it('keeps only the latest entry for the same analysis task', () => {
  const base = {
    kind: 'branch' as const,
    repositoryId: 'repo-1',
    repositoryName: 'example/project',
    label: '分支分析 · example/project',
    route: { name: 'repository' as const, repositoryId: 'repo-1', tab: 'analyses' as const },
    createdAt: '2026-11-26T00:00:00Z',
    syncId: 'sync-1',
  }
  trackAnalysisJob({ ...base, id: 'branch:sync-1' })
  trackAnalysisJob({ ...base, id: 'branch:sync-1', label: '分支分析 · 更新后的名称' })
  expect(trackedAnalysisJobs()).toHaveLength(1)
  expect(trackedAnalysisJobs()[0].label).toBe('分支分析 · 更新后的名称')
  expect(hasTrackedAnalysisJob('branch:sync-1')).toBe(true)
  forgetAnalysisJobs(['branch:sync-1'])
  expect(trackedAnalysisJobs()).toEqual([])
})
