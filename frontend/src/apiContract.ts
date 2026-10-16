/**
 * 新页面请求层的公共契约原语。
 *
 * 与 historicalContract.ts 同一立场：不符合约定的正文一律判为不可用，既不猜测缺失字段，
 * 也不部分采用看起来正确的部分。区别只是服务对象——历史契约服务旧工作台的
 * `/api/review-batch`，这里服务模型中心与预测用的六个既有 `/api/v1` 接口，因此不共享解析器。
 */

export const CONTRACT_MESSAGE = '服务返回的数据与约定不一致，未展示结果'

/** 正文不符合约定：服务端成功响应不满足契约，或本地构造的请求上下文不完整。 */
export class ContractError extends Error {
  constructor(message: string = CONTRACT_MESSAGE) {
    super(message)
    this.name = 'ContractError'
  }
}

export interface ApiErrorDetail {
  field: string
  reason: string
}

/** 服务端按统一错误体返回的失败：code/message/requestId 可直接展示，details 可定位字段。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string
  readonly details: ApiErrorDetail[]

  constructor(options: { status: number; code: string; message: string; requestId: string; details?: ApiErrorDetail[] }) {
    super(options.message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.requestId = options.requestId
    this.details = options.details ?? []
  }
}

export type PlainData = string | number | boolean | null | PlainData[] | { [key: string]: PlainData }

/** 网络层失败：请求没有拿到可解析的响应，与「服务端拒绝了请求」是两回事。 */
export class NetworkError extends Error {
  constructor(message = '无法连接后端服务，请确认服务正在运行后重试') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** 请求被调用方主动取消（换页、清除凭据或组件卸载），不是失败。 */
export class CancelledError extends Error {
  constructor(message = '请求已取消') {
    super(message)
    this.name = 'CancelledError'
  }
}

export function contractFailed(message: string = CONTRACT_MESSAGE): never {
  throw new ContractError(message)
}

export function record(value: unknown, message?: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) contractFailed(message)
  return value as Record<string, unknown>
}

export function recordList(value: unknown, message?: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) contractFailed(message)
  return value.map((item) => record(item, message))
}

export function text(value: unknown, message?: string): string {
  if (typeof value !== 'string' || value === '') contractFailed(message)
  return value
}

export function textOrNull(value: unknown, message?: string): string | null {
  return value === null || value === undefined ? null : text(value, message)
}

export function flag(value: unknown, message?: string): boolean {
  if (typeof value !== 'boolean') contractFailed(message)
  return value
}

export function textList(value: unknown, message?: string): string[] {
  if (!Array.isArray(value)) contractFailed(message)
  return value.map((item) => text(item, message))
}

export function finiteNumber(value: unknown, message?: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) contractFailed(message)
  return value
}

export function riskNumber(value: unknown, message?: string): number {
  const parsed = finiteNumber(value, message)
  if (parsed < 0 || parsed > 1) contractFailed(message)
  return parsed
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX64_SHAPE = /^[0-9a-f]{64}$/
const UTC_ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** 目录身份一律是服务端 `uuid4()` 的小写规范串。 */
export function uuidText(value: unknown, message?: string): string {
  const raw = text(value, message)
  if (!UUID_SHAPE.test(raw)) contractFailed(message)
  return raw
}

/** 模型哈希、schema 哈希、输入哈希、候选身份与 manifest 校验值都是裸的 64 位小写十六进制。 */
export function hexDigest(value: unknown, message?: string): string {
  const raw = text(value, message)
  if (!HEX64_SHAPE.test(raw)) contractFailed(message)
  return raw
}

export function utcTimestamp(value: unknown, message?: string): string {
  const raw = text(value, message)
  if (!UTC_ISO_SHAPE.test(raw)) contractFailed(message)
  return raw
}

/** 只接受可安全渲染的 JSON 数据：拒绝函数、undefined、非有限数与过深嵌套。 */
export function plainData(value: unknown, message?: string, depth = 0): PlainData {
  if (depth > 4) contractFailed(message)
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : contractFailed(message)
  if (Array.isArray(value)) return value.map((item) => plainData(item, message, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, PlainData> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = plainData(item, message, depth + 1)
    }
    return result
  }
  return contractFailed(message)
}

export function plainDataOrNull(value: unknown, message?: string): PlainData | null {
  return value === null || value === undefined ? null : plainData(value, message)
}

/** 判断一个未知错误是否属于可公开反馈的失败（其余一律按内部错误处理）。 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
