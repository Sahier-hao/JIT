/**
 * 团队凭据的输入、确认与清除（任务 2.3、MPW-02、design D2）。
 *
 * 要证明的行为：输入是掩码的、凭据只存在于应用内存、清除后不再有任何请求带上它、
 * 每次更换或清除都会推进代次让在途响应失效。
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialProvider, CredentialPanel } from './credentials'
import { useCredential } from './credentialContext'
import { useResource } from './requestState'

function Probe() {
  const { token, generation } = useCredential()
  return (
    <p>
      代次 <b data-testid="generation">{generation}</b> 凭据长度 <b data-testid="length">{token.length}</b>
    </p>
  )
}

function ResourceProbe({ loader }: { loader: (context: { token: string }) => Promise<string> }) {
  const resource = useResource(loader)
  return <p data-testid="status">{resource.status}</p>
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CredentialPanel', () => {
  it('输入框是掩码的，且只有显式提交后才进入内存状态', async () => {
    const user = userEvent.setup()
    render(
      <CredentialProvider>
        <CredentialPanel />
        <Probe />
      </CredentialProvider>,
    )
    const input = screen.getByLabelText('团队访问凭据')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText('凭据只保存在本页内存，刷新后需要重新输入。')).toBeVisible()

    await user.type(input, 'team-secret-value')
    // 还没提交：状态里没有凭据，也没有发生过任何请求。
    expect(screen.getByTestId('length')).toHaveTextContent('0')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))

    expect(screen.getByTestId('length')).toHaveTextContent(String('team-secret-value'.length))
    expect(screen.getByText('已输入凭据（仅本页内存）')).toBeVisible()
    expect(screen.getByRole('button', { name: '清除凭据' })).toBeVisible()
    // 提交后输入框连同其中的明文一起从界面上消失。
    expect(screen.queryByLabelText('团队访问凭据')).not.toBeInTheDocument()
  })

  it('凭据不写入 localStorage、sessionStorage 或 URL', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/?mode=demo')
    render(
      <CredentialProvider>
        <CredentialPanel />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), 'team-secret-value')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))

    const dump = JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } })
    expect(dump).not.toContain('team-secret-value')
    expect(window.location.href).not.toContain('team-secret-value')
    expect(document.body.innerHTML).not.toContain('team-secret-value')
  })

  it('清除凭据后回到未输入状态，代次继续推进', async () => {
    const user = userEvent.setup()
    render(
      <CredentialProvider>
        <CredentialPanel />
        <Probe />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), 'team-secret-value')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    expect(screen.getByTestId('generation')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: '清除凭据' }))
    expect(screen.getByTestId('length')).toHaveTextContent('0')
    expect(screen.getByTestId('generation')).toHaveTextContent('2')
    expect(screen.getByLabelText('团队访问凭据')).toHaveValue('')
    expect(screen.queryByText('已输入凭据（仅本页内存）')).not.toBeInTheDocument()
  })

  it('可以更换凭据，更换过程中不显示旧凭据的任何片段', async () => {
    const user = userEvent.setup()
    render(
      <CredentialProvider>
        <CredentialPanel />
        <Probe />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), 'first-secret')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    await user.click(screen.getByRole('button', { name: '更换凭据' }))

    const input = screen.getByLabelText('团队访问凭据')
    expect(input).toHaveValue('')
    expect(document.body.innerHTML).not.toContain('first-secret')

    await user.type(input, 'second-secret')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    expect(screen.getByTestId('length')).toHaveTextContent(String('second-secret'.length))
    expect(document.body.innerHTML).not.toContain('second-secret')
  })

  it('空白输入不会建立凭据', async () => {
    const user = userEvent.setup()
    render(
      <CredentialProvider>
        <CredentialPanel />
        <Probe />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), '   ')
    expect(screen.getByRole('button', { name: '使用凭据' })).toBeDisabled()
    expect(screen.getByTestId('generation')).toHaveTextContent('0')
  })

  it('侧栏重新挂载后，尚未确认的输入不丢失', async () => {
    const user = userEvent.setup()
    // 壳会随路由与数据加载重新挂载（真实缺陷：草稿放在面板局部状态时会被静默丢弃）。
    function Shell({ mounted }: { mounted: boolean }) {
      return <CredentialProvider>{mounted ? <CredentialPanel /> : <p>加载中</p>}</CredentialProvider>
    }
    const { rerender } = render(<Shell mounted />)
    await user.type(screen.getByLabelText('团队访问凭据'), 'typed-but-not-confirmed')
    rerender(<Shell mounted={false} />)
    rerender(<Shell mounted />)
    expect(screen.getByLabelText('团队访问凭据')).toHaveValue('typed-but-not-confirmed')
  })
})

describe('凭据与受保护请求的关系', () => {
  it('没有凭据时不发请求，只有需要凭据的提示', async () => {
    const loader = vi.fn(async () => 'ok')
    render(
      <CredentialProvider>
        <ResourceProbe loader={loader} />
      </CredentialProvider>,
    )
    expect(screen.getByTestId('status')).toHaveTextContent('credential-required')
    expect(loader).not.toHaveBeenCalled()
  })

  it('输入凭据后发起请求，清除后立即回到需要凭据状态', async () => {
    const user = userEvent.setup()
    const loader = vi.fn(async () => 'ok')
    render(
      <CredentialProvider>
        <CredentialPanel />
        <ResourceProbe loader={loader} />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), 'team-secret-value')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(loader).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '清除凭据' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('credential-required'))
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('更换凭据会重新请求，且不会用旧凭据下的结果顶替', async () => {
    const user = userEvent.setup()
    const loader = vi.fn(async (context: { token: string }) => context.token)
    render(
      <CredentialProvider>
        <CredentialPanel />
        <ResourceProbe loader={loader} />
      </CredentialProvider>,
    )
    await user.type(screen.getByLabelText('团队访问凭据'), 'first-secret')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: '更换凭据' }))
    await user.type(screen.getByLabelText('团队访问凭据'), 'second-secret')
    await user.click(screen.getByRole('button', { name: '使用凭据' }))
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    expect(loader.mock.calls[1]?.[0]).toEqual({ token: 'second-secret', signal: expect.any(AbortSignal) })
  })
})
