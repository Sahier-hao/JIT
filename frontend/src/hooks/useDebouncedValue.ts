import { useEffect, useState } from 'react'

/**
 * 把变化频繁的值延后到停止变化后再使用。
 *
 * 只用于"输入即请求"的场景（搜索框）：延迟期间不触发请求，也就不会让列表闪空。
 * 其他依赖直接传 0；此时返回值与入参同步，不额外渲染。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (delayMs <= 0 || value === settled) return
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs, settled])
  return delayMs > 0 ? settled : value
}
