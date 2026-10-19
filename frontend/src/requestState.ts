import { ApiError, ContractError, NetworkError } from './apiContract'

export type FailureKind =
  | 'network'
  | 'contract'
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
