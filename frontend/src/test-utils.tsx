import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as baseRender, renderHook as baseRenderHook } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

export { screen, waitFor, within, cleanup, fireEvent, act } from '@testing-library/react'

/**
 * 带 QueryClient 的测试渲染：直接渲染页面组件时也能使用数据 hook。
 * 每个测试独立客户端，避免缓存跨用例泄漏。
 */
export function render(ui: ReactElement, options?: Parameters<typeof baseRender>[1]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return baseRender(<QueryClientProvider client={client}>{ui as ReactNode}</QueryClientProvider>, options)
}

/** 带 QueryClient 的 hook 测试渲染。 */
export function renderHook<Result, Props>(
  hook: (props: Props) => Result,
  options?: { initialProps?: Props },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return baseRenderHook(hook, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}
