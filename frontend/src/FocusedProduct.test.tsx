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
  expect(screen.getByRole('button', { name: '新建分析' })).toBeVisible()
  expect(screen.queryByText('设置团队连接')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '实验室' })).not.toBeInTheDocument()
  for (const [, options] of fetch.mock.calls) expect(new Headers(options?.headers).has('Authorization')).toBe(false)
})
it.each(['#/models', '#/predict', '#/predictions/11111111-1111-4111-8111-111111111111', '#/lab/demo/commits', '#/settings/connection'])('retires the old tool at %s', async hash => {
  emptyApi(); window.history.replaceState({}, '', '/'+hash); render(<App />)
  expect(await screen.findByRole('heading', { name: '这个入口已移除' })).toBeVisible()
  expect(screen.getByRole('button', { name: '返回项目' })).toBeVisible()
})
it('starts a repository analysis without a connection detour', async () => {
  emptyApi(); render(<App />); const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '新建分析' }))
  expect(await screen.findByRole('textbox', { name: '仓库地址' })).toBeVisible()
  expect(screen.queryByRole('textbox', { name: '团队访问凭据' })).not.toBeInTheDocument()
})
