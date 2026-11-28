import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PROJECT, response } from '@/features/projects/projectActivity.fixture'
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

it('leaves the branch blank so the backend can use the repository default', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    tasks: [completedTask()], total: 1, limit: 20, offset: 0,
  }))

  render(<RepositoryDatasetBuildDialog
    open
    onOpenChange={vi.fn()}
    onCompleted={vi.fn()}
    onLoginRequired={vi.fn()}
    initialRepositoryUrl="https://github.com/example/current"
  />)

  const input = await screen.findByLabelText('构建分支')
  expect(input).toHaveValue('')
  expect(input).toHaveAttribute('placeholder', '留空使用仓库默认分支')
  expect(screen.getByRole('button', { name: '开始构建' })).toBeEnabled()
})

it('treats HEAD as the repository default instead of showing it as a branch', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    tasks: [completedTask()], total: 1, limit: 20, offset: 0,
  }))

  render(<RepositoryDatasetBuildDialog
    open
    onOpenChange={vi.fn()}
    onCompleted={vi.fn()}
    onLoginRequired={vi.fn()}
    initialRepositoryUrl="https://github.com/example/current"
    initialBranch="HEAD"
  />)

  expect(await screen.findByLabelText('构建分支')).toHaveValue('')
})

it('submits without a branch and shows the resolved default branch', async () => {
  let posted: Record<string, unknown> | undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).endsWith('/user/dataset-builds') && init?.method === 'POST') {
      posted = JSON.parse(String(init.body))
      return response(task({
        repositoryId: null, branch: 'master', status: 'completed', stage: 'completed',
        datasetName: 'current', datasetVersion: 'current-2024-01-01_2024-12-31',
        queuePosition: null,
      }))
    }
    throw new Error(`unexpected request ${String(path)}`)
  })

  render(<RepositoryDatasetBuildDialog
    open
    onOpenChange={vi.fn()}
    onCompleted={vi.fn()}
    onLoginRequired={vi.fn()}
    initialRepositoryUrl="https://github.com/example/current"
  />)

  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始构建' }))

  expect(posted).toEqual({ repositoryUrl: 'https://github.com/example/current' })
  expect(await screen.findByLabelText('构建分支')).toHaveValue('master')
})

afterEach(() => vi.restoreAllMocks())

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
  render(<RepositoryDatasetBuildDialog projectId={PROJECT} initialRepositoryUrl="https://github.com/example/project" initialBranch="main" open onOpenChange={vi.fn()} onCompleted={navigate} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  expect(await screen.findByLabelText('构建分支')).toHaveValue('main')
  await user.click(screen.getByRole('combobox', { name: '采集范围' }))
  await user.click(await screen.findByRole('option', { name: '自定义日期' }))
  async function pickDate(label: string, value: string) {
    await user.click(screen.getByLabelText(label))
    await user.type(screen.getByLabelText(`${label}手动输入`), value)
    await user.click(screen.getByRole('button', { name: '应用日期' }))
  }
  await pickDate('开始日期', '2024-01-01')
  await pickDate('结束日期', '2025-01-01')
  await user.click(screen.getByRole('button', { name: '开始构建' }))
  expect(await screen.findByText('已完成', {}, { timeout: 3000 })).toBeVisible()
  expect(screen.getByText('kamei14-git-v2-project-2024-01-01_2024-12-31')).toBeVisible()
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/training-tasks'))).toBe(false)
  await user.click(screen.getByRole('button', { name: '查看数据' }))
  expect(navigate).toHaveBeenCalledWith('kamei14-git-v2-project-2024-01-01_2024-12-31')
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
  render(<RepositoryDatasetBuildDialog projectId={PROJECT} initialRepositoryUrl="https://github.com/example/project" initialBranch="release" open onOpenChange={vi.fn()} onCompleted={vi.fn()} onLoginRequired={vi.fn()}/>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始构建' }))
  expect(await screen.findByText('分支不可读')).toBeVisible()
  expect(screen.getByLabelText('构建分支')).toHaveValue('release')
  expect(screen.getByRole('button', { name: '按原参数重试' })).toBeVisible()
})

it('starts a fresh build instead of reopening a completed task', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/dataset-builds?limit=20&offset=0')) {
      return response({ tasks: [task({
        status: 'completed', stage: 'completed', datasetName: 'kamei14-git-v2-project',
        datasetVersion: 'kamei14-git-v2-project-2024-01-01_2024-12-31',
      })], total: 1, limit: 20, offset: 0 })
    }
    return response({})
  })
  render(<RepositoryDatasetBuildDialog projectId={PROJECT} initialRepositoryUrl="https://github.com/example/project" initialBranch="main" open onOpenChange={vi.fn()} onCompleted={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByRole('button', { name: '开始构建' })).toBeVisible()
  expect(screen.getByLabelText('构建分支')).toHaveValue('main')
  expect(screen.queryByRole('button', { name: '查看数据' })).not.toBeInTheDocument()
})

it('opens the exact legacy project task outside the recent list', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(task({
    taskId: 'build-deep-link', status: 'completed', stage: 'completed',
    datasetName: 'project', datasetVersion: 'project-2024-01-01_2024-12-31',
  })))
  render(<RepositoryDatasetBuildDialog projectId={PROJECT} initialTaskId="build-deep-link" open
    onOpenChange={vi.fn()} onCompleted={vi.fn()} onLoginRequired={vi.fn()}/>)
  expect(await screen.findByText('已完成')).toBeVisible()
  expect(screen.getByRole('button', { name: '查看数据' })).toBeVisible()
  expect(String(fetch.mock.calls[0][0])).toContain(`/repositories/${PROJECT}/dataset-builds/build-deep-link`)
})
