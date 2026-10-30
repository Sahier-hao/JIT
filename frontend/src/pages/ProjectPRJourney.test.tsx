import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { FixedPRSnapshot, PullRequestWork } from './PullRequestJourney'
import { createWork, readWorks, saveWork, WORK_KEY } from '../prReview'
import { snapshot } from '../prReview.fixture'
import { PROJECT, response } from '../projectActivity.fixture'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
function sourceApi(source = snapshot()) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : init?.method === 'POST' ? response({ snapshot: source, checkedAt: source.capturedAt, remoteState: 'open' }) : response(source)) }
it('opens notification snapshots read-only without creating a work sheet or changing an existing draft', async () => {
  const old = snapshot(); old.repositoryId = PROJECT
  const work = createWork(old); work.rounds.v1.scratch = '原阅读草稿'; saveWork(work)
  const incoming = snapshot('v2', 'e'.repeat(40)); incoming.repositoryId = PROJECT
  sourceApi(incoming); const before = localStorage.getItem(WORK_KEY), navigate = vi.fn(), user = userEvent.setup()
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v2" navigate={navigate}/>)
  await screen.findByRole('button', { name: '明确开始此版本新一轮' })
  expect(localStorage.getItem(WORK_KEY)).toBe(before)
  await user.click(screen.getByRole('button', { name: '返回原阅读轮次' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  expect(readWorks()[0].viewedSnapshotId).toBe('v1')
  await user.click(screen.getByRole('button', { name: '明确开始此版本新一轮' }))
  expect(readWorks()[0].viewedSnapshotId).toBe('v2')
  expect(readWorks()[0].rounds.v1.scratch).toBe('原阅读草稿')
})
it('does not create local work for unopened server notifications', async () => {
  const source = snapshot(); source.repositoryId = PROJECT; sourceApi(source)
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v1" navigate={vi.fn()}/>)
  await screen.findByRole('button', { name: '开始审查此固定版本' })
  expect(readWorks()).toEqual([])
  // 只读详情允许生成项目级模型分析，但不得写入个人工作单。
  await userEvent.setup().click(screen.getByText('风险概览'))
  expect(await screen.findByRole('button', { name: '生成本版本模型线索' })).toBeVisible()
  expect(readWorks()).toEqual([])
})
it('adds an explicit historical round without moving latest snapshot backwards', async () => {
  const latest = snapshot('v2', 'e'.repeat(40)); latest.repositoryId = PROJECT; latest.capturedAt = '2026-10-29T00:00:00Z'
  saveWork(createWork(latest)); const old = snapshot(); old.repositoryId = PROJECT
  sourceApi(old); const user = userEvent.setup()
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v1" navigate={vi.fn()}/>)
  await user.click(await screen.findByRole('button', { name: '明确进入历史复盘轮次' }))
  expect(readWorks()[0]).toMatchObject({ latestSnapshotId: 'v2', viewedSnapshotId: 'v1' })
})
it('rejects foreign project snapshots and never mutates local work', async () => {
  sourceApi(snapshot()); const before = localStorage.getItem(WORK_KEY)
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId="foreign" snapshotId="v1" navigate={vi.fn()}/>)
  expect(await screen.findByText('PR 固定来源与项目上下文不一致，未修改个人草稿')).toBeVisible()
  expect(localStorage.getItem(WORK_KEY)).toBe(before)
  expect(screen.queryByRole('button', { name: '开始审查此固定版本' })).not.toBeInTheDocument()
})
it('uses base-project context when starting a fork PR and returns to the project', async () => {
  const source = snapshot(); source.repositoryId = PROJECT; source.headRepository = 'contributor/fork'
  const fetch = sourceApi(source), navigate = vi.fn(), user = userEvent.setup()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} repositoryId={PROJECT} navigate={navigate}/>)
  await screen.findByText(/只读预览。先看提交风险排序/)
  expect(readWorks()).toHaveLength(0)
  await user.click(await screen.findByRole('button', { name: '开始审查' }))
  expect(readWorks()).toHaveLength(1)
  await user.click(await screen.findByRole('button', { name: '返回项目 PR 审查' }))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toEqual({ repositoryId: PROJECT })
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: PROJECT, tab: 'prs' })
  await user.click(screen.getByRole('combobox', { name: '个人关注状态' }))
  await user.click(await screen.findByText('已暂停'))
  await waitFor(() => expect(readWorks()[0].interest).toBe('paused'))
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
})
