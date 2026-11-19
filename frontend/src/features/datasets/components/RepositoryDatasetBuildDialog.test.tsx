import { render, screen } from '@/lib/test-utils'
import { expect, it, vi } from 'vitest'
import { RepositoryDatasetBuildDialog } from '@/features/datasets/components/RepositoryDatasetBuildDialog'

function completedTask() {
  return {
    taskId: 'build-1',
    repositoryId: null,
    repositoryUrl: 'https://github.com/example/previous',
    branch: 'main',
    since: '2024-01-01T00:00:00+00:00',
    until: '2025-01-01T00:00:00+00:00',
    commitLimit: 50000,
    status: 'completed',
    stage: 'completed',
    error: null,
    parentTaskId: null,
    datasetName: 'previous',
    datasetVersion: 'previous-2024-01-01_2025-01-01',
    manifestSha256: null,
    quality: { includedRows: 10, positiveLabels: 2 },
    reused: false,
    headCommit: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:00:10Z',
    queuePosition: null,
  }
}

it('starts a fresh build instead of restoring an old completed task', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    tasks: [completedTask()], total: 1, limit: 20, offset: 0,
  }))

  render(<RepositoryDatasetBuildDialog
    open
    onOpenChange={vi.fn()}
    onCompleted={vi.fn()}
    onLoginRequired={vi.fn()}
    initialRepositoryUrl="https://github.com/example/current"
    initialBranch="release"
  />)

  expect(await screen.findByRole('button', { name: '开始构建' })).toBeVisible()
  expect(screen.getByLabelText('公开仓库')).toHaveValue('https://github.com/example/current')
  expect(screen.getByLabelText('构建分支')).toHaveValue('release')
  expect(screen.queryByRole('button', { name: '查看数据' })).not.toBeInTheDocument()
})
