/**
 * 粘贴原始特征 JSON 的严格解析（MPW-06、design D5）。
 *
 * 这里只接受「恰含六个数值字段的特征对象」这一种输入。不用 `JSON.parse`，因为它会把
 * `{"ns":1,"ns":2}` 静默折叠成一条，无法拒绝重复键；也因为它无法把「转义后等价的键」
 * （`"ns"` 与 `"\u006es"`）识别为同一个字段。解析器只服务这一个小对象，不追求通用性。
 */

export type FeatureJsonErrorKind = 'syntax' | 'duplicate' | 'too-long'

export class FeatureJsonError extends Error {
  readonly kind: FeatureJsonErrorKind

  constructor(kind: FeatureJsonErrorKind, message: string) {
    super(message)
    this.name = 'FeatureJsonError'
    this.kind = kind
  }
}

const MAX_LENGTH = 64 * 1024
const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}
const NUMBER_SHAPE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/
const UNICODE_ESCAPE = /^[0-9a-fA-F]{4}$/

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

/** 严格 JSON 解析：拒绝重复键、非法转义、尾随内容与数值前缀（如 `01`、`1px`）。 */
export function parseStrictJson(source: string): unknown {
  let at = 0

  function fail(message: string): never {
    throw new FeatureJsonError('syntax', message)
  }

  function skip(): void {
    while (at < source.length && isWhitespace(source[at])) at += 1
  }

  function expect(character: string): void {
    if (source[at] !== character) fail(`JSON 在第 ${at + 1} 个字符处缺少“${character}”`)
    at += 1
  }

  function parseString(): string {
    expect('"')
    let out = ''
    for (;;) {
      if (at >= source.length) fail('JSON 字符串缺少结束引号')
      const character = source[at]
      if (character === '"') {
        at += 1
        return out
      }
      if (character === '\\') {
        at += 1
        const escape = source[at]
        if (escape !== undefined && escape in ESCAPES) {
          out += ESCAPES[escape]
          at += 1
          continue
        }
        if (escape === 'u') {
          const digits = source.slice(at + 1, at + 5)
          if (!UNICODE_ESCAPE.test(digits)) fail('JSON 字符串里的 \\u 转义不完整')
          out += String.fromCharCode(Number.parseInt(digits, 16))
          at += 5
          continue
        }
        fail('JSON 字符串里的转义字符无效')
      }
      if (character < ' ') fail('JSON 字符串里出现未转义的控制字符')
      out += character
      at += 1
    }
  }

  function parseNumber(): number {
    const match = NUMBER_SHAPE.exec(source.slice(at))
    if (match === null) fail(`JSON 在第 ${at + 1} 个字符处的值不是合法字面量`)
    const literal = match[0]
    const next = source[at + literal.length]
    if (next !== undefined && !isWhitespace(next) && next !== ',' && next !== '}' && next !== ']') {
      fail(`JSON 在第 ${at + 1} 个字符处的数字没有结束`)
    }
    at += literal.length
    return Number(literal)
  }

  function parseValue(): unknown {
    skip()
    const character = source[at]
    if (character === '{') return parseObject()
    if (character === '[') return parseArray()
    if (character === '"') return parseString()
    if (source.startsWith('true', at)) {
      at += 4
      return true
    }
    if (source.startsWith('false', at)) {
      at += 5
      return false
    }
    if (source.startsWith('null', at)) {
      at += 4
      return null
    }
    return parseNumber()
  }

  function parseObject(): Record<string, unknown> {
    expect('{')
    const result: Record<string, unknown> = {}
    const seen = new Set<string>()
    skip()
    if (source[at] === '}') {
      at += 1
      return result
    }
    for (;;) {
      skip()
      if (source[at] !== '"') fail(`JSON 对象在第 ${at + 1} 个字符处的键必须是字符串`)
      const key = parseString()
      if (seen.has(key)) throw new FeatureJsonError('duplicate', key)
      seen.add(key)
      skip()
      expect(':')
      result[key] = parseValue()
      skip()
      if (source[at] === ',') {
        at += 1
        continue
      }
      if (source[at] === '}') {
        at += 1
        return result
      }
      fail(`JSON 对象在第 ${at + 1} 个字符处缺少“,”或“}”`)
    }
  }

  function parseArray(): unknown[] {
    expect('[')
    const result: unknown[] = []
    skip()
    if (source[at] === ']') {
      at += 1
      return result
    }
    for (;;) {
      result.push(parseValue())
      skip()
      if (source[at] === ',') {
        at += 1
        continue
      }
      if (source[at] === ']') {
        at += 1
        return result
      }
      fail(`JSON 数组在第 ${at + 1} 个字符处缺少“,”或“]”`)
    }
  }

  if (source.length > MAX_LENGTH) {
    throw new FeatureJsonError('too-long', `粘贴内容超过 ${MAX_LENGTH} 字符上限`)
  }
  const value = parseValue()
  skip()
  if (at !== source.length) fail(`JSON 在第 ${at + 1} 个字符之后还有多余内容`)
  return value
}

export const FEATURE_FIELDS = ['ns', 'nd', 'nf', 'ent', 'la', 'ld'] as const
export type FeatureField = (typeof FEATURE_FIELDS)[number]

/** 六项中五项是计数（必须可精确表示的整数），ent 是有限非负的浮点熵。 */
export const COUNT_FIELDS: readonly FeatureField[] = ['ns', 'nd', 'nf', 'la', 'ld']

const REQUEST_WRAPPER_KEYS = ['modelId', 'featureSchemaVersion', 'project', 'record']

export type FeatureImport =
  | { ok: true; features: Record<FeatureField, number> }
  | { ok: false; message: string; field?: FeatureField }

function importFailure(message: string, field?: FeatureField): FeatureImport {
  return { ok: false, message, field }
}

/**
 * 解析并校验粘贴的内容；只有完全合法才返回六项数值，调用方据此一次性填表。
 * 任何失败都只返回原因，不返回部分结果——草稿在调用方保持原样。
 */
export function importFeatureJson(source: string): FeatureImport {
  if (source.trim() === '') return importFailure('请先粘贴只含六项数值的特征 JSON')
  let value: unknown
  try {
    value = parseStrictJson(source)
  } catch (error) {
    if (error instanceof FeatureJsonError) {
      if (error.kind === 'duplicate') {
        return importFailure(`特征 JSON 里重复出现字段“${error.message}”，请只保留一项`)
      }
      return importFailure(`粘贴的内容不是合法 JSON：${error.message}`)
    }
    return importFailure('粘贴的内容不是合法 JSON')
  }
  if (Array.isArray(value)) return importFailure('特征 JSON 必须是一个对象，不能是数组')
  if (typeof value !== 'object' || value === null) return importFailure('特征 JSON 必须是一个对象')

  const raw = value as Record<string, unknown>
  const keys = Object.keys(raw)
  const wrapper = keys.filter((key) => REQUEST_WRAPPER_KEYS.includes(key))
  if (wrapper.length > 0) {
    return importFailure(`这里只接受六项特征，请去掉请求包装字段：${wrapper.join('、')}`)
  }
  const missing = FEATURE_FIELDS.filter((name) => !keys.includes(name))
  if (missing.length > 0) return importFailure(`特征 JSON 缺少字段：${missing.join('、')}`)
  const extra = keys.filter((key) => !(FEATURE_FIELDS as readonly string[]).includes(key))
  if (extra.length > 0) return importFailure(`特征 JSON 出现未支持的字段：${extra.join('、')}`)

  const features = {} as Record<FeatureField, number>
  for (const name of FEATURE_FIELDS) {
    const raw_ = raw[name]
    if (typeof raw_ !== 'number' || !Number.isFinite(raw_)) {
      return importFailure(`字段 ${name} 的值必须是数字，字符串或布尔值不被接受`, name)
    }
    if (raw_ < 0) return importFailure(`字段 ${name} 不能是负数`, name)
    if (COUNT_FIELDS.includes(name) && !Number.isSafeInteger(raw_)) {
      return importFailure(`字段 ${name} 必须是可精确表示的整数，超出安全整数范围的数值不被接受`, name)
    }
    features[name] = raw_
  }
  return { ok: true, features }
}
