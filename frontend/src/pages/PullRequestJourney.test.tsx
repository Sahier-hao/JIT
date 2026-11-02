import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PullRequestWork } from './PullRequestJourney'
import { adoptVersion, createWork, readWorks, saveWork } from '../prReview'
import { snapshot } from '../prReview.fixture'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }) }
it('keeps writing and reports unsaved text when browser storage fails', async () => {
  const source = snapshot()
  saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('提交风险排序')
  await user.click(screen.getByText('handle expiry'))
  await screen.findByRole('textbox', { name: '个人笔记' })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
  await user.type(screen.getByRole('textbox', { name: '个人笔记' }), 'do not lose my note')
  expect(screen.getByRole('textbox', { name: '个人笔记' })).toHaveValue('do not lose my note')
  expect(await screen.findByText(/^尚未保存：/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '版本与说明' }))
  await user.click(await screen.findByRole('button', { name: '草稿备份与反馈' }))
  expect(screen.getAllByRole('button', { name: '导出完整草稿' })[0]).toBeEnabled()
})
it('updates a version without resolving old questions and restores the old round', async () => {
  const source = snapshot(); saveWork(createWork(source))
  const updated = snapshot('v2', 'e'.repeat(40)); updated.files[0].blobSha = 'f'.repeat(40)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, options) => options?.method === 'POST'
    ? response({ snapshot: updated, remoteState: 'open', checkedAt: updated.capturedAt }) : response(source))
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('提交风险排序')
  await user.click(screen.getByRole('button', { name: '检查 PR 更新' }))
  expect(await screen.findByRole('button', { name: '开始复核新版本' })).toBeVisible()
  expect(readWorks()[0].rounds.v1.questions[0].status).toBe('open')
  expect(readWorks()[0].rounds.v2.questions[0].status).toBe('open')
})
it('returns from evidence to the original version and code line', async () => {
  const source = snapshot(), work = createWork(source)
  work.rounds.v1.questions[0].evidence = [{ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 1, blobSha: 'c'.repeat(40), note: '' }]
  saveWork(work)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByText('handle expiry'))
  await user.click(await screen.findByRole('button', { name: 'src/token.py:1 · 目标 · 原版本' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '关联 src/token.py:head:1' })).toHaveAttribute('data-focused', 'true'))
})
it('resumes the question being edited after leaving and reopening', async () => {
  const source = snapshot(); saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  const first = render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByText('handle expiry'))
  await user.click(screen.getByRole('button', { name: /这次改动在实现和相关测试中是否保持一致/ }))
  await user.clear(screen.getByRole('textbox', { name: '审查问题内容' }))
  await user.type(screen.getByRole('textbox', { name: '审查问题内容' }), 'Continue checking the boundary test')
  first.unmount()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>)
  await user.click(await screen.findByText('handle expiry'))
  expect(screen.getByRole('textbox', { name: '审查问题内容' })).toHaveValue('Continue checking the boundary test')
})
it('uses current remote state when directly opening a cached code version', async () => {
  const source = snapshot(), checkedAt = '2026-10-27T00:00:00Z'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/repository-models')) return response({ models: [] })
    if (String(path).endsWith('/analyses')) return response({ snapshotId: source.snapshotId, analyses: [] })
    return options?.method === 'POST' ? response({ snapshot: source, checkedAt, remoteState: 'merged' }) : response(source)
  })
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '开始审查' }))
  expect(await screen.findByText(/远端 PR 已合并，当前为历史审查/)).toBeVisible()
  expect(readWorks()[0]).toMatchObject({ remoteState: 'merged', checkedAt })
})
it('restores an unfinished delivery note and conclusion choice after reopening', async () => {
  const source = snapshot(); saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  const first = render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>), user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '输出意见' }))
  await user.click(screen.getByRole('combobox', { name: '本轮结论' }))
  await user.click(await screen.findByRole('option', { name: '暂缓并说明原因' }))
  await user.type(screen.getByRole('textbox', { name: '本轮结论说明' }), 'Still checking the expiry boundary')
  first.unmount()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>)
  await user.click(await screen.findByRole('button', { name: '输出意见' }))
  expect(screen.getByRole('combobox', { name: '本轮结论' })).toHaveValue('暂缓并说明原因')
  expect(screen.getByRole('textbox', { name: '本轮结论说明' })).toHaveValue('Still checking the expiry boundary')
})

it('opens an old evidence version directly instead of returning to the commit list', async () => {
  const old = snapshot('v1')
  const latest = snapshot('v2', 'e'.repeat(40)); latest.previousSnapshotId = 'v1'
  const work = adoptVersion(createWork(old), latest)
  work.rounds.v1.questions[0].evidence = [{ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 1, blobSha: 'c'.repeat(40), note: '' }]
  saveWork(work)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    if (String(path).endsWith('/repository-models')) return response({ models: [] })
    if (String(path).endsWith('/analyses')) return response({ snapshotId: String(path).includes('v1') ? 'v1' : 'v2', analyses: [] })
    return response(snapshot(String(path).includes('/v1') ? 'v1' : 'v2', String(path).includes('/v1') ? 'b'.repeat(40) : 'e'.repeat(40)))
  })
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('提交风险排序')
  await user.click(screen.getByText('handle expiry'))
  await user.click(await screen.findByRole('button', { name: 'src/token.py:1 · 目标 · 原版本' }))
  await waitFor(() => expect(readWorks()[0].viewedSnapshotId).toBe('v1'))
  expect(screen.queryByText('提交风险排序')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '提交列表' })).toBeVisible()
  await waitFor(() => expect(screen.getByRole('button', { name: '关联 src/token.py:head:1' })).toHaveAttribute('data-focused', 'true'))
})
