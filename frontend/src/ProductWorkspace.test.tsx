import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { hashFor } from './navigation'

const REPO_A = '11111111-1111-4111-8111-111111111111'
const REPO_B = '22222222-2222-4222-8222-222222222222'
const ANALYSIS = '33333333-3333-4333-8333-333333333333'
const SHA = 'a'.repeat(40)
const now = '2026-10-19T00:00:00Z'
function repo(id: string) {
  return { repositoryId: id, url: `https://github.com/example/${id}`, displayName: id === REPO_A ? '项目 A' : '项目 B', defaultBranch: 'release', latestSyncId: ANALYSIS, latestSyncAt: now, viewSyncId: ANALYSIS, headCommit: SHA, commitCount: 1, distribution: { high: 1, medium: 0, low: 0, unknown: 0 }, distributionRule: 'repo-distribution-v1', createdAt: now, updatedAt: now, modelStrategy: 'generic-model', degradeReason: null, runId: null, modelId: null, datasetVersion: 'data-A', limitations: [], latestSync: null, viewContext: { repositoryId: id, syncId: ANALYSIS, branch: 'main', completedAt: now, headCommit: SHA, datasetVersion: 'data-A', modelId: null, runId: null, missingMetadata: [] } }
}
function commit(id = REPO_B) { return { repositoryId: id, viewSyncId: ANALYSIS, commitId: SHA, epoch: 1700000000, risk: .81, addedLines: 2, deletedLines: 3, files: 1, features: { la: 2 }, label: 0, labelNote: null, subject: '真实提交标题', authorName: '作者', originalCommitUrl: null } }
function response(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/v1/repositories') return response({ repositories: [repo(REPO_A), repo(REPO_B)], total: 2, offset: 0, limit: 100 })
    const id = url.pathname.split('/')[4] ?? REPO_B
    if (url.pathname.endsWith('/commits')) return response({ repositoryId: id, viewSyncId: ANALYSIS, total: 1, commits: [commit(id)] })
    if (url.pathname.includes('/commits/')) return response(commit(id))
    return response(repo(id))
  })
}
async function connect() { return userEvent.setup() }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/') })
afterEach(() => vi.restoreAllMocks())
it('keeps repository B and its plan when visiting a report and returning', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'commits' }))
  const fetch = mockApi(); render(<App/>); const user = await connect()
  await screen.findByRole('button', { name: `查看 ${SHA}` })
  expect(screen.getByRole('heading', { name: '项目 B' })).toBeVisible()
  expect(screen.getByText('0.81')).toBeVisible()
  expect(screen.getByText('main 分支', { exact: false })).toBeVisible()
  await user.click(screen.getByRole('button', { name: `加入 ${SHA} 到清单` }))
  await user.click(screen.getByRole('button', { name: '验证报告' }))
  await user.click(screen.getByRole('button', { name: '项目 B' }))
  await screen.findByRole('button', { name: `${SHA} 已在清单` })
  expect(window.location.hash).toContain(REPO_B)
  const calls = fetch.mock.calls.map(call => String(call[0])).filter(path => path.includes('/commits'))
  expect(calls.every(path => path.includes(`viewSyncId=${ANALYSIS}`))).toBe(true)
})
it('rejects a late page from a different analysis instead of showing its scores', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'commits' }))
  const fetch = mockApi()
  const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (...args) => {
    if (String(args[0]).includes('/commits?')) return response({ repositoryId: REPO_A, viewSyncId: ANALYSIS, total: 1, commits: [commit(REPO_A)] })
    return original(...args)
  })
  render(<App/>); await connect()
  await screen.findByText('提交读取失败')
  expect(screen.queryByText('0.81')).not.toBeInTheDocument()
})
it('traverses all repository pages and can select an item beyond the first 100', async () => {
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  const items = Array.from({ length: 101 }, (_, i) => ({ ...repo(`${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`), displayName: `项目 ${i}` }))
  fetch.mockImplementation(async (...args) => {
    const url = new URL(String(args[0]), 'http://localhost')
    if (url.pathname === '/api/v1/repositories') { const offset = Number(url.searchParams.get('offset')); return response({ repositories: items.slice(offset, offset + 100), total: 101, limit: 100, offset }) }
    return original(...args)
  })
  render(<App/>); await connect()
  const last = await screen.findByRole('button', { name: '项目 100' }); await userEvent.click(last)
  await waitFor(() => expect(window.location.hash).toContain('00000064-1111-4111-8111-111111111111'))
  expect(fetch.mock.calls.some(call => String(call[0]).endsWith('offset=100'))).toBe(true)
})

it('ignores an earlier repository response after navigating to another repository', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_A, viewSyncId: ANALYSIS, view: 'commits' }))
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  let release!: (value: Response) => void
  const pending = new Promise<Response>(resolve => { release = resolve })
  fetch.mockImplementation(async (...args) => String(args[0]).includes(`${REPO_A}/commits?`) ? pending : original(...args))
  render(<App/>); const user = await connect()
  await user.click(await screen.findByRole('button', { name: '项目 B' }))
  await screen.findByText('0.81')
  await act(async () => release(response({ repositoryId: REPO_A, viewSyncId: ANALYSIS, total: 1, commits: [{ ...commit(REPO_A), risk: .99 }] })))
  expect(screen.queryByText('0.99')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '项目 B' })).toBeVisible()
})

it('reports total mismatches rather than presenting an empty successful analysis', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'commits' }))
  const fetch = mockApi(); const original = fetch.getMockImplementation()!
  fetch.mockImplementation(async (...args) => String(args[0]).includes('/commits?') ? response({ repositoryId: REPO_B, viewSyncId: ANALYSIS, total: 0, commits: [] }) : original(...args))
  render(<App/>); await connect()
  expect(await screen.findByRole('alert')).toHaveTextContent('提交总数与固定分析不一致')
})

it('returns from an empty plan to the same fixed analysis', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'plan' }))
  const fetch = mockApi(); render(<App/>); const user = await connect()
  await user.click(await screen.findByRole('button', { name: '返回评审台' }))
  expect(window.location.hash).toBe(hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'commits' }))
  expect(fetch.mock.calls.some(call => new URL(String(call[0]), 'http://localhost').pathname === `/api/v1/repositories/${REPO_B}` && !String(call[0]).includes('viewSyncId='))).toBe(false)
})

it('returns from a report directly to the pinned analysis without resolving a newer result', async () => {
  window.history.replaceState({}, '', '/'+hashFor({ name: 'analysis', repositoryId: REPO_B, viewSyncId: ANALYSIS, view: 'commits' }))
  const fetch = mockApi(); render(<App/>); const user = await connect()
  await screen.findByText('0.81')
  await user.click(screen.getByRole('button', { name: '验证报告' }))
  await user.click(screen.getByRole('button', { name: '项目 B' }))
  await screen.findByText('0.81')
  expect(fetch.mock.calls.some(call => new URL(String(call[0]), 'http://localhost').pathname === `/api/v1/repositories/${REPO_B}` && !String(call[0]).includes('viewSyncId='))).toBe(false)
})
