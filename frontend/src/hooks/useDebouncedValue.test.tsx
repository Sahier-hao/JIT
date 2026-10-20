import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('停止变化后才返回新值', () => {
  const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), { initialProps: { value: 'a' } })
  expect(result.current).toBe('a')
  rerender({ value: 'b' })
  act(() => { vi.advanceTimersByTime(249) })
  expect(result.current).toBe('a')
  act(() => { vi.advanceTimersByTime(1) })
  expect(result.current).toBe('b')
})

it('连续输入只落最后一次', () => {
  const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), { initialProps: { value: '' } })
  for (const value of ['f', 'fi', 'fix']) {
    rerender({ value })
    act(() => { vi.advanceTimersByTime(100) })
  }
  expect(result.current).toBe('')
  act(() => { vi.advanceTimersByTime(250) })
  expect(result.current).toBe('fix')
})

it('延迟为 0 时与入参同步', () => {
  const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), { initialProps: { value: 'a' } })
  rerender({ value: 'b' })
  expect(result.current).toBe('b')
})
