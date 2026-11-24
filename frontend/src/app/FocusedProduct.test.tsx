import { render, screen, waitFor, within } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '@/app/App'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/#/projects') })
afterEach(() => vi.restoreAllMocks())
function emptyApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).includes('/api/user/session')) {
      return new Response(JSON.stringify({ authenticated: true, username: 'reader' }), { status: 200 })
    }
    return new Response(JSON.stringify({ repositories: [], total: 0, offset: 0, limit: 100 }), { status: 200 })
  })
}
it('opens projects immediately without a credential or role step', async () => {
  const fetch = emptyApi(); render(<App />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(await screen.findByRole('heading', { name: '项目' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: '新建项目' })[0]).toBeVisible()
  expect(screen.queryByText('设置团队连接')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '实验室' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '验证报告' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '我的数据' })).toBeVisible()
  for (const [, options] of fetch.mock.calls) expect(new Headers(options?.headers).has('Authorization')).toBe(false)
})
it('opens account settings in a dialog instead of a full personal-center page', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/api/user/session')) return Response.json({ authenticated: true, username: 'reader' })
    if (path.includes('/api/v1/user/profile')) return Response.json({
      username: 'reader', displayName: null, createdAt: 1760000000,
      datasetCount: 0, experimentCount: 0, modelCount: 0,
    })
    return Response.json({ repositories: [], total: 0, offset: 0, limit: 100 })
  })
  render(<App />); const user = userEvent.setup()
  await screen.findByRole('heading', { name: '项目' })
  expect(screen.queryByRole('button', { name: '个人空间' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'reader' }))
  expect(await screen.findByRole('menuitem', { name: '个人中心' })).toBeVisible()
  expect(within(screen.getByRole('menu')).getByText('普通用户')).toBeVisible()
  expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeVisible()
  expect(screen.queryByRole('menuitem', { name: '我的数据' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '我的训练' })).not.toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '我的模型' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: '个人中心' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('heading', { name: '个人中心' })).toBeVisible()
  expect(within(dialog).getByText('数据版本')).toBeVisible()
  expect(within(dialog).getByText('训练实验')).toBeVisible()
  expect(within(dialog).getByText('模型')).toBeVisible()
  await user.click(within(dialog).getByRole('tab', { name: '账户设置' }))
  expect(within(dialog).getByLabelText('显示名称')).toBeVisible()
  expect(within(dialog).getByLabelText('当前密码')).toBeVisible()
  expect(within(dialog).getByLabelText('新密码')).toBeVisible()
  expect(window.location.hash).toBe('#/projects')
  await user.click(within(dialog).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
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
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path.includes('/api/admin/session')) return new Response(JSON.stringify({ authenticated: false, setupRequired: false, username: null }), { status: 200 })
    if (path.includes('/api/user/session')) return new Response(JSON.stringify({ authenticated: true, username: 'reader' }), { status: 200 })
    return new Response(JSON.stringify({ repositories: [], total: 0, offset: 0, limit: 100 }), { status: 200 })
  })
  window.history.replaceState({}, '', '/#/admin')
  render(<App/>)
  expect(await screen.findByRole('heading', { name: '进入管理工作区' }, { timeout: 30000 })).toBeVisible()
  expect(screen.getByLabelText('管理员账户名')).toBeVisible()
  expect(screen.queryByRole('heading', { name: '验证报告' })).not.toBeInTheDocument()
})

it('shows deep methods separately from models that still lack delivered artifacts', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    const body = path.includes('/api/admin/session') ? { authenticated: true, username: 'admin' }
      : path.includes('/api/v1/models') ? {
        models: [],
        candidates: [],
        methods: [
          { method: 'mlp-v1', name: '多层感知机', category: 'deep', registeredModels: 1, deliveredArtifacts: 1 },
          { method: 'random-forest-v1', name: '随机森林', category: 'classic', registeredModels: 0, deliveredArtifacts: 0 },
        ],
        readiness: {
          ready: false, completeArtifacts: 0, unregisteredExperiments: 0, registeredModels: 0,
          readyModels: 0, repositorySelectableModels: 0, defaultModelId: null,
          defaultAvailable: false, reportOnlyArtifacts: 0, issues: [],
        },
      } : path.includes('model-candidates') ? { candidates: [] } : { repositories: [], total: 0, offset: 0, limit: 100 }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  window.history.replaceState({}, '', '/#/admin')
  render(<App/>)
  const user = userEvent.setup()
  const account = await screen.findByRole('button', { name: 'admin' })
  await user.click(account)
  const menu = await screen.findByRole('menu')
  expect(within(menu).getByText('管理员')).toBeVisible()
  expect(within(menu).getByRole('menuitem', { name: '退出管理' })).toBeVisible()
  expect(within(menu).queryByRole('menuitem', { name: '个人中心' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(account).toHaveFocus()
  await user.click(await screen.findByRole('button', { name: '查看产物诊断' }))
  await user.click(await screen.findByText('支持的训练方法'))
  expect(await screen.findByText('多层感知机')).toBeVisible()
  expect(screen.getByText('深度学习')).toBeVisible()
  expect(screen.getByText('无已交付产物')).toBeVisible()
})

