import { render, screen } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { DatasetBuildDialog } from './DatasetBuildDialog'
import { PROJECT, response } from '../projectActivity.fixture'

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'build-1', repositoryId: PROJECT,
    repositoryUrl: 'https://github.com/example/project', branch: 'main',
    since: '2024-01-01T00:00:00+00:00', until: '2025-01-01T00:00:00+00:00',
    commitLimit: 500, status: 'queued', stage: 'queued', error: null,
    parentTaskId: null, datasetName: null, datasetVersion: null,
    manifestSha256: null, quality: null, reused: false, headCommit: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null, queuePosition: 1, ...overrides,
  }
}

it('builds only a dataset, keeps project analysis untouched, and offers explicit follow-up', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).endsWith('/dataset-builds?limit=20&offset=0')) return response({ tasks: [], total: 0, limit: 20, offset: 0 })
    if (String(path).endsWith('/dataset-builds') && init?.method === 'POST') return response(task())
    if (String(path).includes('/dataset-builds/build-1')) return response(task({
      status: 'completed', stage: 'completed', datasetName: 'kamei14-git-v2-project',
      datasetVersion: 'kamei14-git-v2-project-2024-01-01_2024-12-31',
      manifestSha256: 'a'.repeat(64),
      quality: { includedRows: 4210, positiveLabels: 1301 },
      headCommit: 'b'.repeat(40),
      completedAt: '2026-01-01T00:00:10Z',
    }))
    throw new Error(`unexpected request ${String(path)}`)
  })
  const navigate = vi.fn()
  render(<DatasetBuildDialog repositoryId={PROJECT} defaultBranch="main" open onOpenChange={vi.fn()} navigate={navigate}/>)
  const user = userEvent.setup()
  expect(await screen.findByLabelText('数据集构建分支')).toHaveValue('main')
  await user.type(screen.getByLabelText('数据集构建开始日期'), '2024-01-01')
  await user.type(screen.getByLabelText('数据集构建结束日期'), '2025-01-01')
  await user.click(screen.getByRole('button', { name: '开始构建' }))
  expect(await screen.findByText('已完成', {}, { timeout: 3000 })).toBeVisible()
  expect(screen.getByText('kamei14-git-v2-project-2024-01-01_2024-12-31')).toBeVisible()
  expect(screen.getByText(/不会自动训练或替换当前模型/)).toBeVisible()
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/training-tasks'))).toBe(false)
  await user.click(screen.getByRole('button', { name: '查看数据集并选择训练' }))
  expect(navigate).toHaveBeenCalledWith({
    name: 'admin', view: 'datasets', resourceId: 'kamei14-git-v2-project',
    version: 'kamei14-git-v2-project-2024-01-01_2024-12-31',
  })
})

it('keeps the branch and range visible when the build fails', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).endsWith('/dataset-builds?limit=20&offset=0')) return response({ tasks: [], total: 0, limit: 20, offset: 0 })
    if (String(path).endsWith('/dataset-builds') && init?.method === 'POST') return response(task({
      status: 'failed', stage: 'collecting',
      error: { code: 'REPOSITORY_UNAVAILABLE', message: '分支不可读' },
    }))
    return response({})
  })
  render(<DatasetBuildDialog repositoryId={PROJECT} defaultBranch="release" open onOpenChange={vi.fn()} navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始构建' }))
  expect(await screen.findByText('分支不可读')).toBeVisible()
  expect(screen.getByLabelText('数据集构建分支')).toHaveValue('release')
  expect(screen.getByRole('button', { name: '按原参数重试' })).toBeVisible()
})
