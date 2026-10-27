import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MyReviews, PullRequestWork } from './PullRequestJourney'
import { createWork, readWorks, saveWork } from '../prReview'
import { snapshot } from '../prReview.fixture'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200 }) }
it('starts from a real PR response and saves a personal work sheet', async () => {
  const source = snapshot(), navigate = vi.fn()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ snapshot: source, checkedAt: source.capturedAt, remoteState: 'open' }))
  render(<MyReviews navigate={navigate}/>); const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '仓库或 PR 地址' }), source.url)
  await user.click(screen.getByRole('button', { name: '接入审查' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', owner: 'example', repositoryName: 'project', number: 12 }))
  expect(readWorks()[0].rounds.v1.questions.length).toBeGreaterThan(0)
})
it('keeps writing and reports unsaved text when browser storage fails', async () => {
  const source = snapshot()
  saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('作者原始说明')
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
  await screen.findByText('作者原始说明')
  await user.click(screen.getByRole('button', { name: '检查 PR 更新' }))
  expect(await screen.findByRole('button', { name: '开始复核新版本' })).toBeVisible()
  expect(readWorks()[0].rounds.v1.questions[0].status).toBe('open')
  expect(readWorks()[0].rounds.v2.questions[0].status).toBe('open')
})
it('keeps manual review usable when the explicitly selected model is unavailable', async () => {
  const source = snapshot(); saveWork(createWork(source))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/repository-models')) return response({ models: [{ modelId: 'model-selected', name: 'Registered model', method: 'lr', state: 'ready', enabled: true, isDefault: true, repositoryPredictionSupported: true }] })
    if (String(path).endsWith('/analyses')) return options?.method === 'POST'
      ? new Response(JSON.stringify({ error: { code: 'MODEL_DISABLED', message: '所选模型已停用', requestId: 'model-request' } }), { status: 409 })
      : response({ snapshotId: 'v1', analyses: [] })
    return response(source)
  })
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(screen.getByText('本版本的辅助模型线索'))
  await screen.findByRole('option', { name: 'Registered model' })
  await user.selectOptions(await screen.findByRole('combobox', { name: '本版本分析模型' }), 'model-selected')
  await user.click(screen.getByRole('button', { name: '生成本版本模型线索' }))
  expect(await screen.findByText('所选模型已停用')).toBeVisible()
  await user.type(screen.getByRole('textbox', { name: '个人笔记' }), 'manual review continues')
  expect(screen.getByRole('textbox', { name: '个人笔记' })).toHaveValue('manual review continues')
  const call = fetch.mock.calls.find(([path, options]) => String(path).endsWith('/v1/analyses') && options?.method === 'POST')
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ modelId: 'model-selected' })
})
it('returns from evidence to the original version and code line', async () => {
  const source = snapshot(), work = createWork(source)
  work.rounds.v1.questions[0].evidence = [{ snapshotId: 'v1', path: 'src/token.py', side: 'head', line: 1, blobSha: 'c'.repeat(40), note: '' }]
  saveWork(work)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'src/token.py:1 · 目标 · 原版本' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '关联 src/token.py:head:1' })).toHaveAttribute('data-focused', 'true'))
})
it('resumes the question being edited after leaving and reopening', async () => {
  const source = snapshot(); saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  const first = render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>); const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /这次改动在实现和相关测试中是否保持一致/ }))
  await user.clear(screen.getByRole('textbox', { name: '审查问题内容' }))
  await user.type(screen.getByRole('textbox', { name: '审查问题内容' }), 'Continue checking the boundary test')
  first.unmount()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>)
  expect(screen.getByRole('textbox', { name: '审查问题内容' })).toHaveValue('Continue checking the boundary test')
})
it('uses current remote state when directly opening a cached code version', async () => {
  const source = snapshot(), checkedAt = '2026-10-27T00:00:00Z'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, options) => {
    if (String(path).endsWith('/repository-models')) return response({ models: [] })
    if (String(path).endsWith('/analyses')) return response({ snapshotId: source.snapshotId, analyses: [] })
    return options?.method === 'POST' ? response({ snapshot: source, checkedAt, remoteState: 'merged' }) : response(source)
  })
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>)
  expect(await screen.findByText(/远端 PR 已合并，当前为历史审查/)).toBeVisible()
  expect(readWorks()[0]).toMatchObject({ remoteState: 'merged', checkedAt })
})
it('restores an unfinished delivery note and conclusion choice after reopening', async () => {
  const source = snapshot(); saveWork(createWork(source))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async path => String(path).endsWith('/repository-models') ? response({ models: [] }) : String(path).endsWith('/analyses') ? response({ snapshotId: source.snapshotId, analyses: [] }) : response(source))
  const first = render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>), user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '输出意见' }))
  await user.selectOptions(screen.getByRole('combobox', { name: '本轮结论' }), 'defer')
  await user.type(screen.getByRole('textbox', { name: '本轮结论说明' }), 'Still checking the expiry boundary')
  first.unmount()
  render(<PullRequestWork owner="example" repositoryName="project" number={12} navigate={vi.fn()}/>)
  await user.click(await screen.findByRole('button', { name: '输出意见' }))
  expect(screen.getByRole('combobox', { name: '本轮结论' })).toHaveValue('defer')
  expect(screen.getByRole('textbox', { name: '本轮结论说明' })).toHaveValue('Still checking the expiry boundary')
})
