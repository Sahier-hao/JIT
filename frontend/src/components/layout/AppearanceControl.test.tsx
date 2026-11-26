import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import { AppearanceControl } from './AppearanceControl'

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.density
})

it('offers labelled previews and applies theme and density choices', async () => {
  const user = userEvent.setup()
  render(<AppearanceControl/>)

  await user.click(screen.getByRole('button', { name: '外观偏好' }))
  expect(screen.getByRole('heading', { name: '外观偏好' })).toBeVisible()
  expect(screen.getByRole('group', { name: '主题' })).toBeVisible()
  expect(screen.getByRole('group', { name: '阅读密度' })).toBeVisible()

  const steel = screen.getByRole('button', { name: /钢青/ })
  await user.click(steel)
  expect(steel).toHaveAttribute('aria-pressed', 'true')
  expect(document.documentElement.dataset.theme).toBe('steel')
  expect(window.localStorage.getItem('jit.theme')).toBe('steel')

  const compact = screen.getByRole('button', { name: /紧凑/ })
  await user.click(compact)
  expect(compact).toHaveAttribute('aria-pressed', 'true')
  expect(document.documentElement.dataset.density).toBe('compact')
  expect(window.localStorage.getItem('jit.density')).toBe('compact')
})
