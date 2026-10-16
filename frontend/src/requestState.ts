/**
 * 受保护查询的请求状态（MPW-10、design D2/D3）。
 *
 * 统一处理三件事：没有凭据时不发请求、迟到响应不得覆盖当前状态、失败按可公开原因分类。
 * 写请求（登记、创建预测）不走这里——它们只由用户显式触发一次，状态由页面自己持有。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, CancelledError, ContractError, NetworkError } from './apiContract'
import { useCredential } from './credentialContext'

export type ResourceStatus = 'credential-required' | 'loading' | 'ready' | 'failed'

export interface Resource<T> {
  status: ResourceStatus
  data: T | null
  error: unknown
  reload: () => void
}

export interface ResourceContext {
  token: string
  signal: AbortSignal
}

export function useResource<T>(
  loader: (context: ResourceContext) => Promise<T>,
  deps: readonly unknown[] = [],
): Resource<T> {
  const { token, generation } = useCredential()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ status: ResourceStatus; data: T | null; error: unknown }>({
    status: token === '' ? 'credential-required' : 'loading',
    data: null,
    error: null,
  })
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (token === '') {
      setState({ status: 'credential-required', data: null, error: null })
      return
    }
    const controller = new AbortController()
    let live = true
    setState({ status: 'loading', data: null, error: null })
    loaderRef.current({ token, signal: controller.signal }).then(
      (data) => {
        if (live) setState({ status: 'ready', data, error: null })
      },
      (error: unknown) => {
        // 取消或凭据已换代：这次响应不再属于当前上下文，直接丢弃。
        if (!live || error instanceof CancelledError) return
        setState({ status: 'failed', data: null, error })
      },
    )
    return () => {
      live = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, generation, attempt, ...deps])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return { status: state.status, data: state.data, error: state.error, reload }
}

export type FailureKind =
  | 'network'
  | 'contract'
  | 'auth'
  | 'permission'
  | 'config'
  | 'missing'
  | 'field'
  | 'model'
  | 'storage'
  | 'unknown'

export interface FailureView {
  kind: FailureKind
  message: string
  requestId: string
  details: { field: string; reason: string }[]
}

const KIND_BY_CODE: Record<string, FailureKind> = {
  AUTH_REQUIRED: 'auth',
  ACCESS_DENIED: 'permission',
  ACCESS_CONFIG_INVALID: 'config',
  NOT_FOUND: 'missing',
  SCHEMA_UNKNOWN: 'field',
  INPUT_INVALID: 'field',
  INPUT_SCHEMA_MISMATCH: 'field',
  INPUT_LIMIT_EXCEEDED: 'field',
  CONTEXT_MISMATCH: 'field',
  MODEL_NOT_READY: 'model',
  MODEL_INVALID: 'model',
  ARTIFACT_INVALID: 'model',
  ARTIFACT_UNAVAILABLE: 'model',
  INTEGRITY_ERROR: 'model',
  STORAGE_UNAVAILABLE: 'storage',
  INFERENCE_ERROR: 'storage',
}

export function describeFailure(error: unknown): FailureView {
  if (error instanceof NetworkError) {
    return { kind: 'network', message: error.message, requestId: '', details: [] }
  }
  if (error instanceof ContractError) {
    return { kind: 'contract', message: error.message, requestId: '', details: [] }
  }
  if (error instanceof ApiError) {
    return {
      kind: KIND_BY_CODE[error.code] ?? 'unknown',
      message: error.message,
      requestId: error.requestId,
      details: error.details,
    }
  }
  return { kind: 'unknown', message: '发生未预期的错误，请重试', requestId: '', details: [] }
}

/** 服务端把字段错误放在 details 里（field 形如 `record.features.ns`）；表单据此定位。 */
export function fieldReasons(details: readonly { field: string; reason: string }[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const detail of details) result.set(detail.field, detail.reason)
  return result
}
