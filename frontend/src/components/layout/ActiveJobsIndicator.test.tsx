import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ActiveJobsIndicator, type ActiveJob } from '@/components/layout/ActiveJobsIndicator'

const collectionJob: ActiveJob = {
  id: 'collection:1',
  kind: 'collection',
  label: '采集 · example/project',
  detail: '采集中',
  route: { name: 'my-data', view: 'builds' },
}
const trainingJob: ActiveJob = {
  id: 'training:1',
  kind: 'training',
  label: '训练 · demo-2024',
  detail: '训练中 · 2 个方法',
  route: { name: 'my-training', experimentId: 'experiment-1' },
}
const analysisJob: ActiveJob = {
  id: 'analysis:1',
  kind: 'analysis',
  label: '分支分析 · example/project',
  detail: '正在采集 · 队列第 2 位',
  progress: 25,
  route: { name: 'repository', repositoryId: 'project-1', tab: 'analyses' },
}

it('returns directly to the only active job', async () => {
  const navigate = vi.fn()
  render(<ActiveJobsIndicator jobs={[collectionJob]} navigate={navigate}/>)
  await userEvent.setup().click(screen.getByRole('button', { name: '返回采集任务：采集 · example/project' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-data', view: 'builds' })
})

it('lets the user choose between simultaneous jobs', async () => {
  const navigate = vi.fn()
  const user = userEvent.setup()
  render(<ActiveJobsIndicator jobs={[collectionJob, trainingJob]} navigate={navigate}/>)
  await user.click(screen.getByRole('button', { name: '2 个任务进行中' }))
  await user.click(await screen.findByRole('menuitem', { name: /训练 · demo-2024/ }))
  expect(navigate).toHaveBeenCalledWith({ name: 'my-training', experimentId: 'experiment-1' })
})

it('shows measured import progress and reopens the matching task', async () => {
  const navigate = vi.fn()
  const route = { name: 'my-data', view: 'imports', taskId: 'import-1' } as const
  render(<ActiveJobsIndicator navigate={navigate} jobs={[{
    id: 'import:1', kind: 'import', label: '导入 · jit.zip', detail: '写入数据 · 1/2',
    progress: 50, route,
  }]}/>)
  expect(screen.getByRole('progressbar', { name: '数据集导入进度' })).toHaveAttribute('aria-valuenow', '50')
  await userEvent.setup().click(screen.getByRole('button', { name: '返回导入任务：导入 · jit.zip' }))
  expect(navigate).toHaveBeenCalledWith(route)
})

it('shows analysis stage progress and returns to the project analysis view', async () => {
  const navigate = vi.fn()
  const route = analysisJob.route
  render(<ActiveJobsIndicator jobs={[analysisJob]} navigate={navigate}/>)
  expect(screen.getByRole('progressbar', { name: '分析进度' })).toHaveAttribute('aria-valuenow', '25')
  await userEvent.setup().click(screen.getByRole('button', { name: '返回分析任务：分支分析 · example/project' }))
  expect(navigate).toHaveBeenCalledWith(route)
})
