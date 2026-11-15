import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as baseRender, renderHook as baseRenderHook } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { mantineTheme } from './lib/mantineTheme'
import { ReviewAccountProvider } from './reviewAccount'

export const TEST_REVIEW_ACCOUNT = 'alice'

export { screen, waitFor, within, cleanup, fireEvent, act } from '@testing-library/react'

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MantineProvider theme={mantineTheme} env="test"><QueryClientProvider client={client}><ReviewAccountProvider value={{ status: 'authenticated', account: TEST_REVIEW_ACCOUNT, generation: 0 }}>{children}</ReviewAccountProvider></QueryClientProvider></MantineProvider>
  }
}

/**
 * 带 Mantine 与 QueryClient 的测试渲染：直接渲染页面组件时也能使用数据 hook 与组件库。
 * 每个测试独立客户端，避免缓存跨用例泄漏。
 */
export function render(ui: ReactElement, options?: Parameters<typeof baseRender>[1]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return baseRender(ui, { wrapper: wrapper(client), ...options })
}

/** 带 Mantine 与 QueryClient 的 hook 测试渲染。 */
export function renderHook<Result, Props>(
  hook: (props: Props) => Result,
  options?: { initialProps?: Props },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return baseRenderHook(hook, { ...options, wrapper: wrapper(client) })
}
