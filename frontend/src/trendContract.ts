/**
 * 历史趋势聚合的契约解析（DTD-01～DTD-04、design D8/D10）。
 *
 * 存在性驱动：`summary.trendBuckets` **不存在**即"该运行未提供趋势聚合"；存在但结构或取值
 * 与冻结结构不符即"趋势视图不可用"，并给出可公开的原因（不含路径与堆栈）。
 *
 * 该解析 MUST 与工作台的批次解析分离：`historicalContract.ts` 不校验这个键，坏键也不会让
 * 工作台列表、详情、清单或基线摘要变为不可用（DTD-02）。
 */

export const TREND_PARTITIONS = ['train', 'validation', 'test'] as const

export type TrendPartition = (typeof TREND_PARTITIONS)[number]

export interface TrendPartitionCount {
  commits: number
  positives: number
}

/** 比例或分布值：`value` 有值时 `reason` 必须为 null，反之必须给出非空原因（沿用既有 {value, reason} 形态）。 */
export interface TrendMeasure {
  value: number | null
  reason: string | null
}

export interface TrendRisk {
  count: number
  median: number | null
  p90: number | null
  reason: string | null
  /**
   * 可选的**期望风险**。后端将来提供时，洞察优先用它做估计（design D4 的择优缝）；
   * 目前没有运行产出该字段，因此它是可选的前向兼容字段，不改变既有聚合的合法性。
   */
  mean?: number
}

export interface TrendBucket {
  start: string
  end: string
  commits: number
  positives: number
  observedRate: TrendMeasure
  byPartition: Record<TrendPartition, TrendPartitionCount>
  risk: TrendRisk | null
}

export interface TrendAggregate {
  grain: 'month'
  timezone: string
  minSample: number
  buckets: TrendBucket[]
}

export type TrendResult =
  | { state: 'absent' }
  | { state: 'invalid'; reason: string }
  | { state: 'ready'; data: TrendAggregate }

/** 聚合不合法时的内部信号：只携带可公开的原因，不外泄路径或堆栈。 */
class TrendInvalid extends Error {}

function bad(reason: string): never {
  throw new TrendInvalid(reason)
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad(`${field} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(raw: Record<string, unknown>, names: readonly string[], field: string): void {
  const keys = Object.keys(raw)
  if (keys.length !== names.length || !names.every((name) => name in raw)) {
    bad(`${field} 的字段集合与约定不符（应为 ${names.join('、')}）`)
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') bad(`${field} 必须是非空字符串`)
  return value
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_WITH_ZONE.test(value) || !Number.isFinite(Date.parse(value))) {
    bad(`${field} 必须是带时区的 ISO 时间`)
  }
  return value
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    bad(`${field} 必须是非负整数`)
  }
  return value
}

function ratio(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    bad(`${field} 必须是 0 与 1 之间的有限数`)
  }
  return value
}

/** `{value, reason}` 的互斥校验：有值不给原因，无值必须给原因。 */
function measure(entry: unknown, field: string): TrendMeasure {
  const raw = object(entry, field)
  exactKeys(raw, ['value', 'reason'], field)
  const value = raw['value']
  const reason = raw['reason']
  if (value === null) {
    if (typeof reason !== 'string' || reason.trim() === '') bad(`${field} 无值时必须给出原因`)
    return { value: null, reason }
  }
  if (reason !== null) bad(`${field} 有值时不应同时给出原因`)
  return { value: ratio(value, `${field}.value`), reason: null }
}

function partitionCounts(entry: unknown, field: string): Record<TrendPartition, TrendPartitionCount> {
  const raw = object(entry, field)
  exactKeys(raw, TREND_PARTITIONS, field)
  const result = {} as Record<TrendPartition, TrendPartitionCount>
  for (const name of TREND_PARTITIONS) {
    const part = object(raw[name], `${field}.${name}`)
    exactKeys(part, ['commits', 'positives'], `${field}.${name}`)
    const commits = count(part['commits'], `${field}.${name}.commits`)
    const positives = count(part['positives'], `${field}.${name}.positives`)
    if (positives > commits) bad(`${field}.${name} 的正标签数不能超过提交数`)
    result[name] = { commits, positives }
  }
  return result
}

/** 风险分布：只覆盖测试分区的记录，count 不得超过该桶的测试提交数。 */
function risk(entry: unknown, field: string, testCommits: number): TrendRisk | null {
  if (entry === null) return null
  const raw = object(entry, field)
  // 四个必需键之外，只允许可选的前向兼容字段 `mean`（design D4 的择优缝）。
  const required = ['count', 'median', 'p90', 'reason']
  const keys = Object.keys(raw)
  if (!required.every((name) => name in raw) || keys.some((name) => !required.includes(name) && name !== 'mean')) {
    bad(`${field} 的字段集合与约定不符（应为 count、median、p90、reason，可选 mean）`)
  }
  let mean: number | undefined
  if ('mean' in raw) mean = ratio(raw['mean'], `${field}.mean`)
  const size = count(raw['count'], `${field}.count`)
  if (size > testCommits) bad(`${field}.count 不能超过该桶的测试提交数`)
  const median = raw['median']
  const p90 = raw['p90']
  const reason = raw['reason']
  if ((median === null) !== (p90 === null)) bad(`${field} 的中位数与 p90 必须同时有值或同时为空`)
  const optional = mean === undefined ? {} : { mean }
  if (median === null) {
    if (typeof reason !== 'string' || reason.trim() === '') bad(`${field} 无值时必须给出原因`)
    return { count: size, median: null, p90: null, reason, ...optional }
  }
  if (reason !== null) bad(`${field} 有值时不应同时给出原因`)
  return {
    count: size,
    median: ratio(median, `${field}.median`),
    p90: ratio(p90, `${field}.p90`),
    reason: null,
    ...optional,
  }
}

function bucket(entry: unknown, field: string): TrendBucket {
  const raw = object(entry, field)
  exactKeys(raw, ['start', 'end', 'commits', 'positives', 'observedRate', 'byPartition', 'risk'], field)
  const start = timestamp(raw['start'], `${field}.start`)
  const end = timestamp(raw['end'], `${field}.end`)
  if (Date.parse(start) >= Date.parse(end)) bad(`${field} 的起始时间必须早于结束时间`)
  const commits = count(raw['commits'], `${field}.commits`)
  const positives = count(raw['positives'], `${field}.positives`)
  if (positives > commits) bad(`${field} 的正标签数不能超过提交数`)
  const observedRate = measure(raw['observedRate'], `${field}.observedRate`)
  const byPartition = partitionCounts(raw['byPartition'], `${field}.byPartition`)
  const sum = TREND_PARTITIONS.reduce(
    (total, name) => ({
      commits: total.commits + byPartition[name].commits,
      positives: total.positives + byPartition[name].positives,
    }),
    { commits: 0, positives: 0 },
  )
  if (sum.commits !== commits) bad(`${field} 的分区提交数之和不等于该桶提交数`)
  if (sum.positives !== positives) bad(`${field} 的分区正标签数之和不等于该桶正标签数`)
  return { start, end, commits, positives, observedRate, byPartition, risk: risk(raw['risk'], `${field}.risk`, byPartition.test.commits) }
}

/**
 * 解析 `summary.trendBuckets` 的原始值。
 *
 * `undefined`（键不存在）为"未提供"；`null` 或其它形状不合法为"不可用"。
 */
export function parseTrendBuckets(raw: unknown): TrendResult {
  if (raw === undefined) return { state: 'absent' }
  try {
    const data = object(raw, 'trendBuckets')
    exactKeys(data, ['grain', 'timezone', 'minSample', 'buckets'], 'trendBuckets')
    if (data['grain'] !== 'month') bad('trendBuckets.grain 目前只支持按月聚合')
    const timezone = text(data['timezone'], 'trendBuckets.timezone')
    if (timezone !== 'UTC+08:00') bad('trendBuckets.timezone 与约定的界面时区不一致')
    const minSample = count(data['minSample'], 'trendBuckets.minSample')
    if (minSample < 1) bad('trendBuckets.minSample 必须至少为 1')
    const rawBuckets = data['buckets']
    if (!Array.isArray(rawBuckets) || rawBuckets.length === 0) bad('trendBuckets.buckets 必须是非空数组')
    const buckets = rawBuckets.map((entry, index) => bucket(entry, `trendBuckets.buckets[${index}]`))
    for (let index = 1; index < buckets.length; index += 1) {
      const previous = buckets[index - 1]
      const current = buckets[index]
      if (Date.parse(current.start) < Date.parse(previous.start)) bad('时间桶必须按起始时间升序排列')
      // 空月是否产出桶在规格中未固定，因此只禁止重叠，不要求首尾严格相接。
      if (Date.parse(current.start) < Date.parse(previous.end)) bad('时间桶之间不能重叠')
    }
    return { state: 'ready', data: { grain: 'month', timezone, minSample, buckets } }
  } catch (error) {
    if (error instanceof TrendInvalid) return { state: 'invalid', reason: error.message }
    return { state: 'invalid', reason: '趋势聚合与约定不符，无法解析' }
  }
}

/** 从运行摘要里取出并解析趋势聚合；摘要缺失或不是对象时视为"未提供"。 */
export function parseSummaryTrend(summary: unknown): TrendResult {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return { state: 'absent' }
  return parseTrendBuckets((summary as Record<string, unknown>)['trendBuckets'])
}
