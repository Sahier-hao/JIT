import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { NewProjectForm } from './NewProjectForm'

const NOW = '2026-10-22T12:00:00Z'
function created() {
  return { repositoryId: '11111111-1111-4111-8111-111111111111', url: 'https://github.com/example/app', displayName: 'app', defaultBranch: null, latestSyncId: null, latestSyncAt: null, viewSyncId: null, headCommit: null, commitCount: 0, distribution: { high: 0, medium: 0, low: 0, unknown: 0 }, distributionRule: 'repo-distribution-v1', createdAt: NOW, updatedAt: NOW, modelStrategy: null, degradeReason: null, runId: null, modelId: null, datasetVersion: null, limitations: [], latestSync: null, viewContext: null }
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.restoreAllMocks())

it('creates a project from the trimmed url and opens the project page', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(created(), 201))
  const navigate = vi.fn()
  render(<NewProjectForm navigate={navigate}/>)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '仓库地址' }), '  https://github.com/example/app  ')
  await user.click(screen.getByRole('button', { name: '建立项目' }))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: created().repositoryId }, true))
  const [path, options] = fetch.mock.calls[0]
  expect(String(path)).toBe('/api/v1/repositories')
  expect(options?.method).toBe('POST')
  expect(JSON.parse(String(options?.body))).toEqual({ repositoryUrl: 'https://github.com/example/app', autoUpdate: false })
})

it('keeps the input and explains a server rejection', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: 'INPUT_INVALID', message: '仓库地址需要是公开的 HTTP(S) 地址', requestId: 'request-1', details: [] } }, 422))
  const navigate = vi.fn()
  render(<NewProjectForm navigate={navigate}/>)
  const user = userEvent.setup()
  const input = screen.getByRole('textbox', { name: '仓库地址' })
  await user.type(input, 'https://github.com/example/app')
  await user.click(screen.getByRole('button', { name: '建立项目' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('仓库地址需要是公开的 HTTP(S) 地址')
  expect(screen.getByText(/request-1/)).toBeVisible()
  expect(input).toHaveValue('https://github.com/example/app')
  expect(navigate).not.toHaveBeenCalled()
})

it('rejects a non-http address before calling the api', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  render(<NewProjectForm navigate={vi.fn()}/>)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '仓库地址' }), 'github.com/example/app')
  await user.click(screen.getByRole('button', { name: '建立项目' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP(S) 地址')
  expect(fetch).not.toHaveBeenCalled()
})
