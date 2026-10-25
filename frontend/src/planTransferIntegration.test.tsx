import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

const repo = '11111111-1111-4111-8111-111111111111', sync = '22222222-2222-4222-8222-222222222222'
const sha = 'a'.repeat(40), other = 'b'.repeat(40), date = '2026-10-25T00:00:00Z'
const source = { repositoryId: repo, viewSyncId: sync, datasetVersion: 'data-A', modelId: null, runId: null }
const manifest = { format: 'jit-review-plan-v1', source, commitIds: [other, sha] }
const sourceContext = JSON.stringify(['repository', repo, sync, 'data-A'])
const key = `jit-review:plan:v3:${encodeURIComponent(sourceContext)}`
const detail = { repositoryId: repo, url: 'https://github.com/example/plan', displayName: '计划项目', defaultBranch: 'main', latestSyncId: sync, latestSyncAt: date, viewSyncId: sync, headCommit: sha, commitCount: 2, distribution: { high: 0, medium: 2, low: 0, unknown: 0 }, distributionRule: 'repo-distribution-v1', createdAt: date, updatedAt: date, modelStrategy: 'generic-model', degradeReason: null, runId: null, modelId: null, datasetVersion: 'data-A', limitations: [], latestSync: null, viewContext: { repositoryId: repo, syncId: sync, branch: 'main', completedAt: date, headCommit: sha, datasetVersion: 'data-A', modelId: null, runId: null, missingMetadata: [] } }
function response(value: unknown) { return new Response(JSON.stringify(value)) }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem(key, JSON.stringify({ schema: 3, sourceContext, entries: [{ commitId: sha, sourceContext, addedAt: date }] }))
  window.history.replaceState({}, '', `/#/projects/${repo}/analyses/${sync}/plan`)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path.includes('/review-plan/validate')) return response(JSON.parse(String(init?.body)))
    if (path.endsWith('/api/v1/repositories?limit=100&offset=0')) return response({ repositories: [detail], total: 1, limit: 100, offset: 0 })
    if (path.includes('/commits/')) { const id = path.split('/commits/')[1].split('?')[0]; return response({ repositoryId: repo, viewSyncId: sync, commitId: id, epoch: 1700000000, risk: .2, addedLines: 2, deletedLines: 1, files: 1, features: {}, label: 0, labelNote: null, subject: `提交 ${id}`, authorName: '作者', originalCommitUrl: null }) }
    if (path.includes('/commits?')) return response({ repositoryId: repo, viewSyncId: sync, total: 2, commits: [] })
    return response(detail)
  })
})
afterEach(() => vi.restoreAllMocks())

it('merges checked IDs into real browser storage without changing original timestamps or order', async () => {
  render(<App/>); const user = userEvent.setup()
  await screen.findByRole('button', { name: `从计划移除 ${sha}` })
  await user.click(screen.getByText('计划备份与恢复'))
  await user.upload(screen.getByLabelText('选择计划备份'), new File([JSON.stringify(manifest)], 'plan.json', { type: 'application/json' }))
  await user.click(await screen.findByRole('button', { name: '合并到当前计划' }))
  await waitFor(() => expect(JSON.parse(localStorage.getItem(key)!).entries.map((entry: {commitId: string}) => entry.commitId)).toEqual([sha,other]))
  expect(JSON.parse(localStorage.getItem(key)!).entries[0].addedAt).toBe(date)
  expect(await screen.findByRole('button', { name: `从计划移除 ${other}` })).toBeVisible()
})

it('does not replace the current in-memory or saved plan when storage refuses the merge', async () => {
  render(<App/>); const user = userEvent.setup()
  await screen.findByRole('button', { name: `从计划移除 ${sha}` })
  const before = localStorage.getItem(key)
  await user.click(screen.getByText('计划备份与恢复'))
  await user.upload(screen.getByLabelText('选择计划备份'), new File([JSON.stringify(manifest)], 'plan.json', { type: 'application/json' }))
  const button = await screen.findByRole('button', { name: '合并到当前计划' })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await user.click(button)
  expect(await screen.findByText(/浏览器未能保存合并计划/)).toBeVisible()
  expect(localStorage.getItem(key)).toBe(before)
  expect(screen.queryByRole('button', { name: `从计划移除 ${other}` })).not.toBeInTheDocument()
})
