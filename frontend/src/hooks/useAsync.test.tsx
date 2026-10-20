import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('前置条件未就绪时不发请求', () => {
  const run = vi.fn(async () => 'data')
  const { result } = renderHook(() => useAsync({ key: null, run }))
  expect(run).not.toHaveBeenCalled()
  expect(result.current.status).toBe('idle')
  expect(result.current.data).toBeUndefined()
})

it('同一身份只请求一次，retry 才重发', async () => {
  const run = vi.fn(async () => 'data')
  const { result, rerender } = renderHook(() => useAsync({ key: 'same', run }))
  await waitFor(() => expect(result.current.status).toBe('ready'))
  expect(result.current.data).toBe('data')
  rerender()
  expect(run).toHaveBeenCalledTimes(1)
  act(() => result.current.retry())
  await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
})

it('身份变化时中止上一个请求', () => {
  const signals: AbortSignal[] = []
  const run = (signal: AbortSignal) => {
    signals.push(signal)
    return new Promise<string>(() => {})
  }
  const { rerender } = renderHook(({ id }) => useAsync({ key: id, run }), { initialProps: { id: 'a' } })
  rerender({ id: 'b' })
  expect(signals).toHaveLength(2)
  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)
})

it('刷新失败时保留上一份数据', async () => {
  let attempt = 0
  const run = vi.fn(async () => {
    attempt += 1
    if (attempt === 1) return 'first'
    throw new Error('boom')
  })
  const { result, rerender } = renderHook(({ id }) => useAsync({ key: id, run, keepPrevious: true }), { initialProps: { id: 'a' } })
  await waitFor(() => expect(result.current.data).toBe('first'))
  rerender({ id: 'b' })
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.data).toBe('first')
  expect(result.current.error).not.toBe('')
})

it('身份边界变化时丢弃旧数据', async () => {
  const run = vi.fn(async () => 'first')
  const { result, rerender } = renderHook(
    ({ id }) => useAsync({ key: `${id}|q`, resetKey: id, run, keepPrevious: true }),
    { initialProps: { id: 'a' } },
  )
  await waitFor(() => expect(result.current.data).toBe('first'))
  run.mockRejectedValue(new Error('boom'))
  rerender({ id: 'b' })
  await waitFor(() => expect(result.current.status).toBe('error'))
  expect(result.current.data).toBeUndefined()
})

it('轮询只在页面可见时触发', async () => {
  vi.useFakeTimers()
  const run = vi.fn(async () => 'data')
  renderHook(() => useAsync({ key: 'poll', run, pollMs: 1000 }))
  await act(async () => { await Promise.resolve() })
  expect(run).toHaveBeenCalledTimes(1)

  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => { vi.advanceTimersByTime(3000) })
  expect(run).toHaveBeenCalledTimes(1)

  visibility.mockReturnValue('visible')
  await act(async () => { vi.advanceTimersByTime(1000) })
  expect(run).toHaveBeenCalledTimes(2)
})
