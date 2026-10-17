import { expect, it } from 'vitest'
import { parseSummaryTrend, parseTrendBuckets } from './trendContract'
import { trendBucketsFixture, trendFixture, trendFixtureWithoutAggregate } from './trend-fixture'

/** 可变副本：测试只关心"某处不合法时是否被判为不可用"，不需要保留字面量类型。 */
type Json = Record<string, unknown>
const clone = (): Json => JSON.parse(JSON.stringify(trendBucketsFixture())) as Json
const bucketsOf = (data: Json): Json[] => data['buckets'] as Json[]
const at = (data: Json, index: number): Json => bucketsOf(data)[index]
const byPartitionOf = (bucket: Json): Json => bucket['byPartition'] as Json

it('缺键表示该运行未提供趋势聚合（存在性驱动）', () => {
  expect(parseTrendBuckets(undefined)).toEqual({ state: 'absent' })
  expect(parseSummaryTrend({})).toEqual({ state: 'absent' })
  expect(parseSummaryTrend(undefined)).toEqual({ state: 'absent' })
  expect(parseSummaryTrend(trendFixtureWithoutAggregate().summary)).toEqual({ state: 'absent' })
})

it('合法聚合解析为 ready，并保留空值桶的空值与原因', () => {
  const result = parseSummaryTrend(trendFixture().summary)
  expect(result.state).toBe('ready')
  if (result.state !== 'ready') return
  expect(result.data.grain).toBe('month')
  expect(result.data.timezone).toBe('UTC+08:00')
  expect(result.data.minSample).toBe(20)
  expect(result.data.buckets).toHaveLength(3)
  expect(result.data.buckets[1].observedRate).toEqual({ value: null, reason: '该桶提交数 8 低于最小样本 20' })
  expect(result.data.buckets[2].risk).toEqual({ count: 56, median: 0.0931, p90: 0.4218, reason: null })
  expect(result.data.buckets[0].risk).toBeNull()
})

it('顶层结构与取值不合法时判为不可用并给出可公开原因', () => {
  const cases: [string, (data: Json) => void, RegExp][] = [
    ['grain', (data) => { data['grain'] = 'week' }, /grain/],
    ['timezone', (data) => { data['timezone'] = 'UTC' }, /timezone/],
    ['minSample 为零', (data) => { data['minSample'] = 0 }, /minSample/],
    ['buckets 为空', (data) => { data['buckets'] = [] }, /buckets/],
    ['多余键', (data) => { data['extra'] = 1 }, /字段集合/],
    ['null', (data) => { data['buckets'] = null }, /buckets/],
  ]
  for (const [, mutate, expected] of cases) {
    const data = clone()
    mutate(data)
    const result = parseTrendBuckets(data)
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') {
      expect(result.reason).toMatch(expected)
      // 可公开：不含路径、堆栈或进程信息。
      expect(result.reason).not.toMatch(/[A-Za-z]:\\|\/frontend|at Object|stack/i)
    }
  }
})

it('桶的字段集合、数值边界与合计不合法时判为不可用', () => {
  const cases: [string, (data: Json) => void, RegExp][] = [
    ['桶字段集合不符', (data) => { delete at(data, 0)['risk'] }, /字段集合/],
    ['缺少分区键', (data) => { delete byPartitionOf(at(data, 0))['train'] }, /train/],
    ['正标签数超过提交数', (data) => { at(data, 0)['positives'] = 999 }, /正标签数不能超过提交数/],
    ['分区提交数合计不符', (data) => { byPartitionOf(at(data, 0))['test'] = { commits: 2, positives: 0 } }, /分区提交数之和/],
    ['分区正标签数合计不符', (data) => {
      byPartitionOf(at(data, 0))['train'] = { commits: 140, positives: 19 }
      byPartitionOf(at(data, 0))['test'] = { commits: 3, positives: 3 }
    }, /分区正标签数之和/],
    ['start 不早于 end', (data) => { at(data, 0)['start'] = at(data, 0)['end'] }, /起始时间必须早于结束时间/],
    ['时间缺时区', (data) => { at(data, 0)['start'] = '2012-01-01T00:00:00' }, /ISO 时间/],
    ['桶乱序', (data) => { bucketsOf(data).reverse() }, /升序|重叠/],
    ['桶重叠', (data) => { at(data, 1)['start'] = '2012-01-15T00:00:00+08:00' }, /重叠/],
    ['提交数为负', (data) => { at(data, 0)['commits'] = -1 }, /非负整数/],
    ['提交数为小数', (data) => { at(data, 0)['commits'] = 1.5 }, /非负整数/],
  ]
  for (const [, mutate, expected] of cases) {
    const data = clone()
    mutate(data)
    const result = parseTrendBuckets(data)
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') expect(result.reason).toMatch(expected)
  }
})

it('observedRate 的 value 与 reason 必须互斥', () => {
  const withValueAndReason = clone()
  at(withValueAndReason, 0)['observedRate'] = { value: 0.5, reason: '不应同时给出' }
  expect(parseTrendBuckets(withValueAndReason)).toMatchObject({ state: 'invalid', reason: /不应同时给出原因/ })

  const emptyWithoutReason = clone()
  at(emptyWithoutReason, 1)['observedRate'] = { value: null, reason: '' }
  expect(parseTrendBuckets(emptyWithoutReason)).toMatchObject({ state: 'invalid', reason: /必须给出原因/ })

  const outOfRange = clone()
  at(outOfRange, 0)['observedRate'] = { value: 1.2, reason: null }
  expect(parseTrendBuckets(outOfRange)).toMatchObject({ state: 'invalid', reason: /0 与 1 之间/ })
})

it('风险分布的取值与互斥关系同样受约束', () => {
  const tooMany = clone()
  at(tooMany, 2)['risk'] = { count: 999, median: 0.1, p90: 0.2, reason: null }
  expect(parseTrendBuckets(tooMany)).toMatchObject({ state: 'invalid', reason: /不能超过该桶的测试提交数/ })

  const halfEmpty = clone()
  at(halfEmpty, 2)['risk'] = { count: 56, median: 0.1, p90: null, reason: null }
  expect(parseTrendBuckets(halfEmpty)).toMatchObject({ state: 'invalid', reason: /同时有值或同时为空/ })

  const emptyWithoutReason = clone()
  at(emptyWithoutReason, 2)['risk'] = { count: 0, median: null, p90: null, reason: '' }
  expect(parseTrendBuckets(emptyWithoutReason)).toMatchObject({ state: 'invalid', reason: /必须给出原因/ })

  const valueWithReason = clone()
  at(valueWithReason, 2)['risk'] = { count: 56, median: 0.1, p90: 0.2, reason: '不应同时给出' }
  expect(parseTrendBuckets(valueWithReason)).toMatchObject({ state: 'invalid', reason: /不应同时给出原因/ })

  const emptyWithReason = clone()
  at(emptyWithReason, 2)['risk'] = { count: 0, median: null, p90: null, reason: '该桶测试记录不足最小样本' }
  expect(parseTrendBuckets(emptyWithReason)).toMatchObject({ state: 'ready' })
})

it('按分区分别记录：桶可以同时覆盖验证与测试分区', () => {
  const result = parseTrendBuckets(clone())
  expect(result.state).toBe('ready')
  if (result.state !== 'ready') return
  const bucket = result.data.buckets[2]
  expect(bucket.byPartition.validation).toEqual({ commits: 40, positives: 7 })
  expect(bucket.byPartition.test).toEqual({ commits: 56, positives: 8 })
  expect(bucket.commits).toBe(96)
  expect(bucket.positives).toBe(15)
})

it('风险分布接受可选的前向兼容字段 mean，越界时判为不可用', () => {
  const withMean = clone()
  at(withMean, 2)['risk'] = { count: 56, median: 0.0931, p90: 0.4218, reason: null, mean: 0.12 }
  const accepted = parseTrendBuckets(withMean)
  expect(accepted.state).toBe('ready')
  if (accepted.state === 'ready') expect(accepted.data.buckets[2].risk).toMatchObject({ mean: 0.12, median: 0.0931 })

  const outOfRange = clone()
  at(outOfRange, 2)['risk'] = { count: 56, median: 0.0931, p90: 0.4218, reason: null, mean: 1.5 }
  expect(parseTrendBuckets(outOfRange)).toMatchObject({ state: 'invalid', reason: /mean/ })

  const unknownField = clone()
  at(unknownField, 2)['risk'] = { count: 56, median: 0.0931, p90: 0.4218, reason: null, mode: 1 }
  expect(parseTrendBuckets(unknownField)).toMatchObject({ state: 'invalid', reason: /字段集合/ })
})
