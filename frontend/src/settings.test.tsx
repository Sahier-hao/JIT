import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { SettingsPage } from './SettingsPage'
import { CredentialProvider } from './credentials'
import { DENSITY_KEY, THEME_KEY } from './preferences'

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/#/settings/appearance') })
afterEach(() => vi.restoreAllMocks())
it('settings has a canonical route and returns to its explicit repository target', async () => {
  const navigate = vi.fn(); const user = userEvent.setup()
  render(<CredentialProvider><SettingsPage route={{ name: 'settings', page: 'connection', returnTo: '#/repositories/B' }} navigate={navigate}/></CredentialProvider>)
  await user.click(screen.getByRole('button', { name: '返回之前页面' }))
  expect(navigate).toHaveBeenCalledWith({ name: 'repository', repositoryId: 'B' })
})
it('persists and applies theme', async () => {
  const user = userEvent.setup(); render(<App/>)
  await user.click(screen.getByRole('button', { name: /炭黑/ }))
  expect(document.documentElement.dataset.theme).toBe('charcoal')
  expect(localStorage.getItem(THEME_KEY)).toBe('charcoal')
})
it('persists density independently of the selected theme', async () => {
  const user = userEvent.setup(); render(<App/>)
  await user.click(screen.getByRole('button', { name: '紧凑' }))
  expect(document.documentElement.dataset.density).toBe('compact')
  expect(localStorage.getItem(DENSITY_KEY)).toBe('compact')
})
it('storage denial preserves this session appearance', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  const user = userEvent.setup(); render(<App/>)
  await user.click(screen.getByRole('button', { name: '紧凑' }))
  expect(document.documentElement.dataset.density).toBe('compact')
})
it('connection route provides a masked runtime-only credential', async () => {
  window.history.replaceState({}, '', '/#/settings/connection')
  const user = userEvent.setup(); render(<App/>)
  const field = screen.getByLabelText('团队访问凭据')
  expect(field).toHaveAttribute('type', 'password')
  await user.type(field, 'temporary-team-secret')
  await user.click(screen.getByRole('button', { name: '使用凭据' }))
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  await user.click(screen.getByRole('button', { name: '清除凭据' }))
  expect(screen.getByLabelText('团队访问凭据')).toHaveValue('')
})
