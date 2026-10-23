import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/#/projects') })
afterEach(() => vi.restoreAllMocks())
function emptyApi() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ repositories: [], total: 0, offset: 0, limit: 100 }), { status: 200 }))
}
it('opens projects immediately without a credential or role step', async () => {
  const fetch = emptyApi(); render(<App />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(await screen.findByRole('heading', { name: '项目' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '新建项目' })[0]).toBeVisible()
  expect(screen.queryByText('设置团队连接')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '实验室' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '验证报告' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '管理工作区' })).toBeVisible()
  for (const [, options] of fetch.mock.calls) expect(new Headers(options?.headers).has('Authorization')).toBe(false)
})
it.each(['#/models', '#/predict', '#/predictions/11111111-1111-4111-8111-111111111111', '#/lab/demo/commits', '#/settings/connection'])('retires the old tool at %s', async hash => {
  emptyApi(); window.history.replaceState({}, '', '/'+hash); render(<App />)
  expect(await screen.findByRole('heading', { name: '这个入口已移除' })).toBeVisible()
  expect(screen.getByRole('button', { name: '返回项目' })).toBeVisible()
})
it('starts a repository analysis without a connection detour', async () => {
  emptyApi(); render(<App />); const user = userEvent.setup()
  await user.click(await screen.findAllByRole('button', { name: '新建项目' }).then(items => items[0]))
  expect(await screen.findByRole('textbox', { name: '仓库地址' })).toBeVisible()
  expect(screen.queryByRole('textbox', { name: '团队访问凭据' })).not.toBeInTheDocument()
})

it('opens administrator sign-in instead of showing maintenance data to visitors', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => new Response(JSON.stringify(String(input).includes('/api/admin/session')
    ? { authenticated: false, setupRequired: false, username: null }
    : { repositories: [], total: 0, offset: 0, limit: 100 }), { status: 200 }))
  window.history.replaceState({}, '', '/#/admin')
  render(<App/>)
  expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: '验证报告' })).not.toBeInTheDocument()
})

it('shows deep methods separately from models that still lack delivered artifacts', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    const body = path.includes('/api/admin/session') ? { authenticated: true, username: 'admin' }
      : path.endsWith('/api/v1/models') ? { models: [], methods: [
        { method: 'mlp-v1', name: '多层感知机', category: 'deep', registeredModels: 1, deliveredArtifacts: 1 },
        { method: 'random-forest-v1', name: '随机森林', category: 'classic', registeredModels: 0, deliveredArtifacts: 0 },
      ] } : path.includes('model-candidates') ? { candidates: [] } : { repositories: [], total: 0, offset: 0, limit: 100 }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  window.history.replaceState({}, '', '/#/admin')
  render(<App/>)
  expect(await screen.findByText('多层感知机')).toBeVisible()
  expect(screen.getByText('深度学习')).toBeVisible()
  expect(screen.getByText('无已交付产物')).toBeVisible()
})

