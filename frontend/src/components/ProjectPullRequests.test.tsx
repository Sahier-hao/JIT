import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectPullRequests } from './ProjectPullRequests'
import { PRTrackingPanel } from './PRTrackingPanel'
import { modelChoices, PROJECT, prPage, response, tracking } from '../projectActivity.fixture'
import { WORK_KEY } from '../prReview'
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })
it('loads missing PR cache once without submitting analysis and preserves the project context', async () => {
  const navigate = vi.fn(), fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path, init) => response(prPage({ checkedAt: init?.method === 'POST' ? '2026-10-29T00:00:00Z' : null })))
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={navigate}/>); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '查看 PR' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'pr-work', repositoryId: PROJECT, owner: 'example', repositoryName: 'project', number: 12 })
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(fetch.mock.calls.some(([path]) => String(path).includes('/analyses'))).toBe(false)
  expect(localStorage.getItem(WORK_KEY)).toBeNull()
})
it('retries failed discovery and paginates closed and all ranges explicitly', async () => {
  let failed = true
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async path => {
    const url = new URL(String(path), 'http://localhost'), page = Number(url.searchParams.get('page')) || 1
    if (failed) return response({ error: { code: 'GITHUB_UNAVAILABLE', message: '远端暂不可用', requestId: 'r' } }, 503)
    return response(prPage({ page, hasMore: page === 1 }))
  })
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>); const user = userEvent.setup()
  await screen.findByText('远端暂不可用'); failed = false
  await user.click(screen.getByRole('button', { name: '重新加载' }))
  await screen.findByRole('heading', { name: '#12 修复边界' })
  await user.click(screen.getByText('已关闭 / 合并'))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=closed&page=1'))).toBe(true))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=closed&page=2'))).toBe(true))
  await user.click(screen.getByText('全部'))
  await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('state=all&page=1'))).toBe(true))
})
it('explains unsupported non-GitHub projects truthfully', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(prPage({ supported: false, owner: null, name: null, pullRequests: [] })))
  render(<ProjectPullRequests repositoryId={PROJECT} navigate={vi.fn()}/>)
  expect(await screen.findByText('此项目不是公开 GitHub 来源')).toBeVisible()
  expect(screen.queryByRole('button', { name: '查看 PR' })).not.toBeInTheDocument()
})
function trackingApi(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (path, init) => {
    if (String(path).includes('/repository-models')) return response({ models: modelChoices })
    if (String(path).includes('/pull-requests')) return response(prPage({ hasMore: true }))
    return response(tracking({ ...overrides, ...(init?.method === 'PATCH' ? JSON.parse(String(init.body)) : {}) }))
  })
}
it('requires an explicit existing PR confirmation and pins the selected model rather than the new default', async () => {
  const fetch = trackingApi()
  render(<PRTrackingPanel repositoryId={PROJECT}/>); const user = userEvent.setup()
  expect(await screen.findByLabelText('固定自动分析模型')).toHaveTextContent('原固定模型 · model-original')
  await user.click(screen.getByLabelText('固定自动分析模型'))
  expect(await screen.findByRole('option', { name: /停用模型/ })).toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{Escape}')
  expect(screen.getByText(/还有后续页，以上不是完整数量/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '启用自动分析' }))
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: '取消设置' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '启用自动分析' }))
  await user.click(screen.getByRole('button', { name: '确认启用并处理现有开放 PR' }))
  const body = JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))
  expect(body).toEqual({ enabled: true, modelId: 'model-original', intervalSeconds: 300, confirmExisting: true })
  expect(body).not.toHaveProperty('scratch')
  expect(localStorage.getItem(WORK_KEY)).toBeNull()
})
it('does not silently substitute a disabled fixed model and pauses without sending model changes', async () => {
  const fetch = trackingApi({ enabled: true, modelId: 'model-disabled' })
  render(<PRTrackingPanel repositoryId={PROJECT}/>); const user = userEvent.setup()
  await screen.findByText(/原选模型已不可用/)
  expect(screen.getByLabelText('固定自动分析模型')).toHaveTextContent('model-disabled')
  expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '暂停自动分析' }))
  await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true))
  expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).toEqual({ enabled: false })
})
