import { render, screen, waitFor, TEST_REVIEW_ACCOUNT } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { FixedPRSnapshot, PullRequestWork } from '@/features/reviews/pages/PullRequestJourney'
import { accountWorkKey, createWork, readWorks, saveWork } from '@/features/reviews/prReview'

import { snapshot } from '@/features/reviews/prReview.fixture'
import { PROJECT, response } from '@/features/projects/projectActivity.fixture'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
function sourceApi(source = snapshot()) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : init?.method === 'POST' ? response({ snapshot: source, checkedAt: source.capturedAt, remoteState: 'open' }) : response(source)) }
it('opens notification snapshots read-only without creating a work sheet or changing an existing draft', async () => {
  const old = snapshot(); old.repositoryId = PROJECT
  const work = createWork(old); work.rounds.v1.scratch = '原阅读草稿'; saveWork(TEST_REVIEW_ACCOUNT, work)
  const incoming = snapshot('v2', 'e'.repeat(40)); incoming.repositoryId = PROJECT
  sourceApi(incoming); const before = localStorage.getItem(accountWorkKey(TEST_REVIEW_ACCOUNT)), navigate = vi.fn(), user = userEvent.setup()
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v2" navigate={navigate}/>)
  await screen.findByRole('button', { name: '明确开始此版本新一轮' })
  expect(localStorage.getItem(accountWorkKey(TEST_REVIEW_ACCOUNT))).toBe(before)
  await user.click(screen.getByRole('button', { name: '返回原阅读轮次' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0].viewedSnapshotId).toBe('v1')
  await user.click(screen.getByRole('button', { name: '明确开始此版本新一轮' }))
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0].viewedSnapshotId).toBe('v2')
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0].rounds.v1.scratch).toBe('原阅读草稿')
})
it('does not create local work for unopened server notifications', async () => {
  const source = snapshot(); source.repositoryId = PROJECT; sourceApi(source)
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v1" navigate={vi.fn()}/>)
  await screen.findByRole('button', { name: '开始审查此固定版本' })
  expect(readWorks(TEST_REVIEW_ACCOUNT)).toEqual([])
  // 分析统一从 PR 列表发起，只读详情不提供分析入口，也不创建工作单。
  expect(screen.queryByRole('button', { name: '生成本版本模型线索' })).not.toBeInTheDocument()
  expect(readWorks(TEST_REVIEW_ACCOUNT)).toEqual([])
})
it('adds an explicit historical round without moving latest snapshot backwards', async () => {
  const latest = snapshot('v2', 'e'.repeat(40)); latest.repositoryId = PROJECT; latest.capturedAt = '2026-10-29T00:00:00Z'
  saveWork(TEST_REVIEW_ACCOUNT, createWork(latest)); const old = snapshot(); old.repositoryId = PROJECT
  sourceApi(old); const user = userEvent.setup()
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v1" navigate={vi.fn()}/>)
  await user.click(await screen.findByRole('button', { name: '明确进入历史复盘轮次' }))
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0]).toMatchObject({ latestSnapshotId: 'v2', viewedSnapshotId: 'v1' })
})

it('restores rule markers in a fixed notification and explicitly saves a candidate into its historical round', async () => {
  const current = snapshot('v2', 'e'.repeat(40)); current.repositoryId = PROJECT; current.capturedAt = '2026-10-29T00:00:00Z'
  saveWork(TEST_REVIEW_ACCOUNT, createWork(current))
  const frozen = snapshot(); frozen.repositoryId = PROJECT
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.endsWith('/candidates')) return response({ snapshotId: 'v1', coverage: {
      side: 'head', analyzerVersion: 'python-ast-v1', files: [{ path: 'src/token.py', side: 'head', reason: null }],
    }, candidates: [{ side: 'head', path: 'src/token.py', line: 1, ruleId: 'py-mutable-default', ruleVersion: '1',
      evidence: 'def collect(items=[]):', message: '可变默认参数会在调用之间共享状态' }] })
    if (path.endsWith('/repository-models')) return response({ models: [] })
    if (path.endsWith('/analyses')) return response({ snapshotId: 'v1', analyses: [] })
    return response(frozen)
  })
  const navigate = vi.fn(), user = userEvent.setup()
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId={PROJECT} snapshotId="v1" navigate={navigate}/>)
  await user.click(await screen.findByRole('button', { name: '查看目标第 1 行的可疑项' }))
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0].viewedSnapshotId).toBe('v2')
  await user.click(screen.getByRole('button', { name: '加入问题草稿' }))
  expect(readWorks(TEST_REVIEW_ACCOUNT)[0]).toMatchObject({ latestSnapshotId: 'v2', viewedSnapshotId: 'v1', rounds: { v1: {
    questions: expect.arrayContaining([expect.objectContaining({ kind: 'suggestion', originSnapshotId: 'v1' })]),
  } } })
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
})
it('rejects foreign project snapshots and never mutates local work', async () => {
  sourceApi(snapshot()); const before = localStorage.getItem(accountWorkKey(TEST_REVIEW_ACCOUNT))
  render(<FixedPRSnapshot owner="example" repositoryName="project" number={12} repositoryId="foreign" snapshotId="v1" navigate={vi.fn()}/>)
  expect(await screen.findByText('PR 固定来源与项目上下文不一致，未修改个人草稿')).toBeVisible()
  expect(localStorage.getItem(accountWorkKey(TEST_REVIEW_ACCOUNT))).toBe(before)
  expect(screen.queryByRole('button', { name: '开始审查此固定版本' })).not.toBeInTheDocument()
})
it('uses base-project context when starting a fork PR and returns to the project', async () => {
  const source = snapshot(); source.repositoryId = PROJECT; source.headRepository = 'contributor/fork'
  const fetch = sourceApi(source), navigate = vi.fn(), user = userEvent.setup()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} repositoryId={PROJECT} navigate={navigate}/>)
  await screen.findByRole('heading', { name: '提交风险排序' })
  expect(readWorks(TEST_REVIEW_ACCOUNT)).toHaveLength(0)
  await user.click(await screen.findByRole('button', { name: '创建审查工作单' }))
  expect(readWorks(TEST_REVIEW_ACCOUNT)).toHaveLength(1)
  await user.click(await screen.findByRole('button', { name: '返回项目 PR 审查' }))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body))).toEqual({ repositoryId: PROJECT })
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: PROJECT, tab: 'prs' })
  await user.click(screen.getByRole('combobox', { name: '个人关注状态' }))
  await user.click(await screen.findByText('已暂停'))
  await waitFor(() => expect(readWorks(TEST_REVIEW_ACCOUNT)[0].interest).toBe('paused'))
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
})
