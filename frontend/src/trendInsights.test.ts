import { describe, expect, it } from 'vitest'
import { DEFAULT_INSIGHTS, INSIGHT_DISCLAIMER, observedGapInsight } from './trendInsights'
import type { TrendAggregate, TrendBucket } from './trendContract'

const measure = (value: number | null, reason: string | null = null) => ({ value, reason })

interface Case {
  start: string
  end: string
  observed: number | null
  testCommits: number
  testPositives: number
  risk: Record<string, unknown> | null
}

function bucket(test: Case): TrendBucket {
  return {
    start: test.start,
    end: test.end,
    commits: test.testCommits + 40,
    positives: test.testPositives,
    observedRate: test.observed === null ? measure(null, '该桶提交数低于最小样本 20') : measure(test.observed),
    byPartition: {
      train: { commits: 40, positives: 0 },
      validation: { commits: 0, positives: 0 },
      test: { commits: test.testCommits, positives: test.testPositives },
    },
    risk: test.risk as unknown as TrendBucket['risk'],
  } as TrendBucket
}

function aggregate(buckets: TrendBucket[], minSample = 20): TrendAggregate {
  return { grain: 'month', timezone: 'UTC+08:00', minSample, buckets }
}

const dense = (start: string, observed: number, median: number, testCommits = 50, testPositives = 10) =>
  bucket({
    start,
    end: '2013-02-01T00:00:00+08:00',
    observed,
    testCommits,
    testPositives,
    risk: { count: testCommits, median, p90: median + 0.2, reason: null },
  })

describe('observedGapInsight（design D4）', () => {
  it('按 |率差| 降序，并列时按桶起点升序保证确定性', () => {
    const early = dense('2012-01-01T00:00:00+08:00', 0.2, 0.1)
    const late = dense('2012-02-01T00:00:00+08:00', 0.05, 0.15)
    const big = dense('2012-03-01T00:00:00+08:00', 0.5, 0.2)
    const result = observedGapInsight.compute(aggregate([late, big, early]))
    expect(result.unavailable).toBe(false)
    if (result.unavailable) return
    expect(result.ranking.map((entry) => entry.bucket.start)).toEqual([
      '2012-03-01T00:00:00+08:00',
      '2012-01-01T00:00:00+08:00',
      '2012-02-01T00:00:00+08:00',
    ])
    expect(result.ranking[0].gap).toBeCloseTo(0.3, 10)
    expect(result.ranking[1].gap).toBeCloseTo(0.1, 10)
    expect(result.ranking[2].gap).toBeCloseTo(-0.1, 10)
  })

  it('样本不足或没有风险统计量的桶不参与，也不当成差异为零', () => {
    const sparse = bucket({ start: '2012-01-01T00:00:00+08:00', end: '2012-02-01T00:00:00+08:00', observed: null, testCommits: 3, testPositives: 1, risk: null })
    const noRisk = bucket({ start: '2012-02-01T00:00:00+08:00', end: '2012-03-01T00:00:00+08:00', observed: 0.2, testCommits: 0, testPositives: 0, risk: null })
    const noMedian = bucket({
      start: '2012-03-01T00:00:00+08:00',
      end: '2012-04-01T00:00:00+08:00',
      observed: 0.2,
      testCommits: 30,
      testPositives: 6,
      risk: { count: 30, median: null, p90: null, reason: '样本不足' },
    })
    expect(observedGapInsight.compute(aggregate([sparse, noRisk, noMedian])).unavailable).toBe(true)
    const reason = observedGapInsight.compute(aggregate([sparse, noRisk, noMedian]))
    if (reason.unavailable) expect(reason.reason).toMatch(/没有桶同时具备/)
    const mixed = observedGapInsight.compute(aggregate([sparse, dense('2012-05-01T00:00:00+08:00', 0.2, 0.1)]))
    if (!mixed.unavailable) expect(mixed.ranking).toHaveLength(1)
  })

  it('只有中位风险时把估计标为近似，并按中位风险折算正例数', () => {
    const result = observedGapInsight.compute(aggregate([dense('2012-01-01T00:00:00+08:00', 0.2, 0.1, 50, 10)]))
    if (result.unavailable) throw new Error('应当可用')
    expect(result.approximate).toBe(true)
    expect(result.ranking[0].estimated).toBeCloseTo(5, 10)
    expect(result.ranking[0].observed).toBe(10)
    expect(result.ranking[0].gap).toBeCloseTo(0.1, 10)
    expect(result.headline).toContain('2012-01')
    expect(result.headline).toContain('20.0%')
    expect(result.headline).toContain('10.0%')
    expect(result.headline).toContain('+10.0')
  })

  it('聚合提供平均风险时优先使用，且不再标记近似', () => {
    const withMean = bucket({
      start: '2012-01-01T00:00:00+08:00',
      end: '2012-02-01T00:00:00+08:00',
      observed: 0.3,
      testCommits: 40,
      testPositives: 12,
      risk: { count: 40, median: 0.1, p90: 0.4, reason: null, mean: 0.2 },
    })
    const result = observedGapInsight.compute(aggregate([withMean]))
    if (result.unavailable) throw new Error('应当可用')
    expect(result.approximate).toBe(false)
    expect(result.ranking[0].estimated).toBeCloseTo(8, 10)
    expect(result.ranking[0].gap).toBeCloseTo(0.1, 10)
  })

  it('文案保持诊断信号的边界，不断言校准结论', () => {
    expect(INSIGHT_DISCLAIMER).toContain('诊断信号')
    expect(INSIGHT_DISCLAIMER).toContain('概率校准')
    expect(INSIGHT_DISCLAIMER).toContain('不代表缺陷率')
    expect(INSIGHT_DISCLAIMER).not.toContain('校准准确')
    expect(INSIGHT_DISCLAIMER).not.toContain('期望值')
  })

  it('默认注册表含这一项，且注册项自带可读标签', () => {
    expect(DEFAULT_INSIGHTS).toHaveLength(1)
    expect(DEFAULT_INSIGHTS[0].kind).toBe('gap')
    expect(DEFAULT_INSIGHTS[0].label).toMatch(/估计与观测的差异/)
    expect(DEFAULT_INSIGHTS[0].compute(aggregate([])).unavailable).toBe(true)
  })
})
