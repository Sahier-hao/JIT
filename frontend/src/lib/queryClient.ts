import { QueryClient } from '@tanstack/react-query'

/**
 * 全局查询客户端：本地单用户应用，不做自动重试与窗口聚焦重取，
 * 避免把一次失败放大成多次请求；页面切换时仍复用短期缓存。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 2_000,
      gcTime: 5 * 60_000,
    },
  },
})
