import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { EVENT_READ_KEY, ProjectEvents, ProjectPersonal, eventRoute } from './ProjectActivity'
import { createWork, readWorks, saveWork, WORK_KEY } from '../prReview'
import { snapshot } from '../prReview.fixture'
import { event, PROJECT, response } from '../projectActivity.fixture'
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
it('marks notifications read locally without completing reviews or uploading any personal state', async () => {
  const work = createWork(snapshot()); work.rounds.v1.scratch = '私人笔记'; saveWork(work)
  const before = localStorage.getItem(WORK_KEY), navigate = vi.fn()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ events: [event()], total: 1, limit: 20, offset: 0 }))
  render(<ProjectEvents navigate={navigate}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '查看固定来源' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12, snapshotId: 'v2' })
  expect(JSON.parse(localStorage.getItem(EVENT_READ_KEY)!)).toEqual(['event-1'])
  expect(localStorage.getItem(WORK_KEY)).toBe(before)
  expect(fetch.mock.calls.every(([, init]) => init?.method === 'GET' && init.body === undefined)).toBe(true)
})
it('does not create a work sheet for server facts and falls back to fixed analysis identity', async () => {
  const fact = event({ owner: null, name: null })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ events: [fact], total: 1, limit: 20, offset: 0 }))
  render(<ProjectEvents repositoryId={PROJECT} navigate={vi.fn()}/>)
  await screen.findByText('新版本分析就绪')
  expect(readWorks()).toEqual([])
  expect(eventRoute(fact)).toEqual({ name: 'analysis', repositoryId: PROJECT, viewSyncId: 's2', view: 'commits' })
})
it('separates private local work from public events, keeps pause local and links the same work key', async () => {
  const source = snapshot(); source.repositoryId = PROJECT
  const work = createWork(source); work.interest = 'paused'; saveWork(work)
  const navigate = vi.fn(), fetch = vi.spyOn(globalThis, 'fetch')
  render(<ProjectPersonal repositoryId={PROJECT} navigate={navigate}/>); const user = userEvent.setup()
  expect(await screen.findByText(/已暂停个人关注/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '继续个人工作' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps malformed local read storage untouched and surfaces recovery instead of clearing it', async () => {
  localStorage.setItem(EVENT_READ_KEY, 'malformed')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ events: [event()], total: 1, limit: 20, offset: 0 }))
  render(<ProjectEvents navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('新版本分析就绪')
  await user.click(screen.getByRole('button', { name: '标为已读' }))
  await waitFor(() => expect(localStorage.getItem(EVENT_READ_KEY)).toBe('malformed'))
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
})
