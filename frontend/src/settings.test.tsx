/**
 * 设置面板行为（3.2 / 3.3 / 3.4，对应 IP-05 与 IP-07）。
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { CredentialProvider } from './credentials'
import type { Route } from './navigation'
import { DENSITY_KEY, THEME_KEY } from './preferences'

const route: Route = { name: 'models' }

function renderShell() {
  return render(
    <CredentialProvider>
      <AppShell route={route} navigate={() => {}} mode="demo" onMode={() => {}} view="list" count={0} onView={() => {}}>
        <p>内容</p>
      </AppShell>
    </CredentialProvider>,
  )
}

describe('设置面板', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    delete document.documentElement.dataset.sidebar
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('从图标轨打开，Esc 关闭并把焦点还给触发按钮', async () => {
    const user = userEvent.setup()
    renderShell()

    const trigger = screen.getByRole('button', { name: '设置' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '设置' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('点击遮罩关闭面板', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByTestId('settings-scrim'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('切换主题写入 localStorage 并应用到根节点', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '设置' }))

    const dialog = screen.getByRole('dialog', { name: '设置' })
    await user.click(within(dialog).getByRole('button', { name: /炭黑/ }))

    expect(document.documentElement.dataset.theme).toBe('charcoal')
    expect(localStorage.getItem(THEME_KEY)).toBe('charcoal')
    expect(within(dialog).getByRole('button', { name: /炭黑/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('切换密度写入 localStorage 并应用到根节点', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '设置' }))

    await user.click(screen.getByRole('button', { name: '紧凑' }))
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(localStorage.getItem(DENSITY_KEY)).toBe('compact')
  })

  it('存储不可用时仍然渲染并保持默认外观', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })

    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('button', { name: /钢青/ }))

    // 主题仍在本次会话生效，只是不持久化
    expect(document.documentElement.dataset.theme).toBe('steel')
    expect(screen.getByText('内容')).toBeVisible()
  })

  it('收起侧栏切换 data-sidebar 并持久化，且可从图标轨恢复', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole('button', { name: '收起侧栏' }))
    expect(document.documentElement.dataset.sidebar).toBe('rail')
    expect(localStorage.getItem('jit.sidebar')).toBe('rail')

    // 收起后开关仍留在图标轨上，可再次展开
    await user.click(screen.getByRole('button', { name: '展开侧栏' }))
    expect(document.documentElement.dataset.sidebar).toBe('expanded')
  })
})
