import { useCallback, useEffect, useRef, useState } from 'react'
import { describeFailure } from '../requestState'

/**
 * 一次网络读取的通用状态机。
 *
 * 四件事只在这里实现一次：请求身份（`key`）、中止上一个请求、刷新时保留旧数据、
 * 进行中作业的轮询。调用方只需要把「什么条件要重新读」编码进 `key`。
 */
export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AsyncResult<T> {
  status: AsyncStatus
  /** 最近一次成功的数据。刷新失败时保留（除非 `resetKey` 变了）。 */
  data: T | undefined
  error: string
  retry: () => void
}

export interface AsyncOptions<T> {
  /** 请求身份；内容变了才重新请求。`null` 表示前置条件未就绪，不发请求。 */
  key: string | null
  /** 实际的读取动作；必须响应 `signal` 中止。 */
  run: (signal: AbortSignal) => Promise<T>
  /** 刷新时是否保留上一份数据（默认丢弃）。 */
  keepPrevious?: boolean
  /** 身份边界：变了就丢弃旧数据，即使 `keepPrevious` 为真。 */
  resetKey?: string
  /** 轮询间隔；页面不可见时跳过这一轮。 */
  pollMs?: number
}

interface Snapshot<T> {
  status: AsyncStatus
  data: T | undefined
  error: string
}

export function useAsync<T>({ key, run, keepPrevious = false, resetKey = '', pollMs }: AsyncOptions<T>): AsyncResult<T> {
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot<T>>(() => ({ status: key === null ? 'idle' : 'loading', data: undefined, error: '' }))
  const runRef = useRef(run)
  runRef.current = run
  const resetRef = useRef(resetKey)
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    if (key === null) {
      setSnapshot(current => current.status === 'idle' ? current : { status: 'idle', data: undefined, error: '' })
      return
    }
    const controller = new AbortController()
    let active = true
    const identityChanged = resetRef.current !== resetKey
    resetRef.current = resetKey
    setSnapshot(current => ({ status: 'loading', data: keepPrevious && !identityChanged ? current.data : undefined, error: '' }))
    runRef.current(controller.signal).then(data => {
      if (active) setSnapshot({ status: 'ready', data, error: '' })
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return
      setSnapshot(current => ({ status: 'error', data: keepPrevious && !identityChanged ? current.data : undefined, error: describeFailure(error).message }))
    })
    return () => { active = false; controller.abort() }
  }, [key, attempt, keepPrevious, resetKey])

  useEffect(() => {
    if (!pollMs || key === null) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') setAttempt(value => value + 1)
    }, pollMs)
    return () => window.clearInterval(timer)
  }, [pollMs, key])

  return { ...snapshot, retry }
}
