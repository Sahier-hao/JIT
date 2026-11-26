import { render, screen } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
import { ActiveJobsIndicator } from '@/components/layout/ActiveJobsIndicator'
import { useActiveUserJobs } from '@/features/account/activeJobs'
import { trackAnalysisJob } from '@/features/projects/analysisJobs'
import { prBatch } from '@/features/projects/projectActivity.fixture'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const SYNC = '22222222-2222-4222-8222-222222222222'

it('publishes a tracked branch analysis to the header and reads its live stage', async () => {
  localStorage.clear()
  trackAnalysisJob({
    id: `branch:${SYNC}`,
    kind: 'branch',
    repositoryId: PROJECT,
    repositoryName: 'example/project',
    label: '分支分析 · example/project',
    route: { name: 'repository', repositoryId: PROJECT, tab: 'analyses' },
    createdAt: '2026-11-26T00:00:00Z',
    syncId: SYNC,
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.includes('/dataset-builds')) return Response.json({ tasks: [] })
    if (url.pathname.includes('/training-experiments')) return Response.json({ experiments: [] })
    if (url.pathname.includes('/dataset-imports')) return Response.json({ tasks: [] })
    if (url.pathname.endsWith(`/repository-syncs/${SYNC}`)) return Response.json({
      syncId: SYNC, repositoryId: PROJECT, repositoryUrl: 'https://github.com/example/project',
      branch: 'feature', since: null, until: null, commitLimit: 500, requestedStrategy: 'generic-model',
      status: 'scoring', stage: 'scoring', datasetVersion: 'data-1', runId: null, modelId: 'model-1',
      modelStrategy: 'generic-model', degradeReason: null, trainRecords: null, trainPositives: null,
      createdAt: '2026-11-26T00:00:00Z', updatedAt: '2026-11-26T00:01:00Z', requestId: null,
      sourceKind: 'branch', queuePosition: null, startedAt: '2026-11-26T00:00:01Z', error: null,
    })
    return Response.json({})
  })
  function Header() {
    return <ActiveJobsIndicator jobs={useActiveUserJobs('reader')} navigate={vi.fn()}/>
  }
  render(<Header/>)
  expect(await screen.findByRole('button', { name: '返回分析任务：分支分析 · example/project' })).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '分析进度' })).toHaveAttribute('aria-valuenow', '88')
  localStorage.clear()
})

it('shows one batch entry with measured PR progress', async () => {
  localStorage.clear()
  trackAnalysisJob({
    id: 'pr-batch:batch-1',
    kind: 'pr-batch',
    repositoryId: PROJECT,
    repositoryName: 'example/project',
    label: 'PR 批量分析 · example/project',
    route: { name: 'repository', repositoryId: PROJECT, tab: 'prs' },
    createdAt: '2026-11-26T00:00:00Z',
    batchId: 'batch-1',
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.includes('/dataset-builds')) return Response.json({ tasks: [] })
    if (url.pathname.includes('/training-experiments')) return Response.json({ experiments: [] })
    if (url.pathname.includes('/dataset-imports')) return Response.json({ tasks: [] })
    if (url.pathname.endsWith('/pull-request-batches/batch-1')) return Response.json(prBatch({
      status: 'running',
      counts: { pending: 0, queued: 1, running: 0, completed: 1, failed: 0, cancelled: 0, interrupted: 0, skipped: 0 },
      submission: { pending: 0, submitted: 2, reused: 0, failed: 0, skipped: 0 },
    }))
    return Response.json({})
  })
  function Header() {
    return <ActiveJobsIndicator jobs={useActiveUserJobs('reader')} navigate={vi.fn()}/>
  }
  render(<Header/>)
  expect(await screen.findByRole('button', { name: '返回分析任务：PR 批量分析 · example/project' })).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '分析进度' })).toHaveAttribute('aria-valuenow', '50')
  localStorage.clear()
})
