import { render, screen, waitFor } from '../test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LandingPage } from './LandingPage'
import { LoginPage } from './LoginPage'

afterEach(() => vi.restoreAllMocks())

it('shows the product introduction and routes to each login role', async () => {
  const navigate = vi.fn()
  render(<LandingPage navigate={navigate} session={null}/>)
  expect(screen.getByRole('heading', { name: /把提交数据变成/ })).toBeVisible()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '用户登录' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'login', role: 'user' })
  await user.click(screen.getByRole('button', { name: '管理员登录' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'login', role: 'admin' })
})

it('logs a user in and continues to the requested page', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input).endsWith('/api/user/login')) {
      return Response.json({ authenticated: true, username: 'reader' })
    }
    return Response.json({ authenticated: false, username: null })
  })
  const navigate = vi.fn()
  const onUser = vi.fn()
  render(<LoginPage route={{ name: 'login', role: 'user' }} session={null} navigate={navigate} onUser={onUser}/>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('用户账户名'), 'reader')
  await user.type(screen.getByLabelText('用户密码'), 'reader-pass-1')
  await user.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(onUser).toHaveBeenCalledWith({ authenticated: true, username: 'reader' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repositories' })
})
