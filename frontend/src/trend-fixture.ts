// 趋势聚合的契约夹具（design D10）：形状照抄冻结结构，供单测与 e2e 共同引用。
// 发明出来的行为测试夹具，不是真实实验，也不是真实证据。
// e2e 目录按 nodenext 解析（tsconfig.node.json），因此这个共享夹具的相对导入必须带 .ts 扩展名，
// 否则 e2e 引用它时整个 node 项目编译失败。
import { historicalFixture } from './historical-fixture.ts'

/** 三个桶：样本充足（训练区间）、样本不足（空值 + 原因）、跨验证与测试分区（含风险分布）。 */
export function trendBucketsFixture(overrides: Record<string, unknown> = {}) {
  const measure = (value: number | null, reason: string | null = null) => ({ value, reason })
  return {
    grain: 'month',
    timezone: 'UTC+08:00',
    minSample: 20,
    buckets: [
      {
        start: '2012-01-01T00:00:00+08:00',
        end: '2012-02-01T00:00:00+08:00',
        commits: 143,
        positives: 21,
        observedRate: measure(0.1469),
        byPartition: {
          train: { commits: 143, positives: 21 },
          validation: { commits: 0, positives: 0 },
          test: { commits: 0, positives: 0 },
        },
        risk: null,
      },
      {
        start: '2012-02-01T00:00:00+08:00',
        end: '2012-03-01T00:00:00+08:00',
        commits: 8,
        positives: 1,
        observedRate: measure(null, '该桶提交数 8 低于最小样本 20'),
        byPartition: {
          train: { commits: 8, positives: 1 },
          validation: { commits: 0, positives: 0 },
          test: { commits: 0, positives: 0 },
        },
        risk: null,
      },
      {
        start: '2013-12-01T00:00:00+08:00',
        end: '2014-01-01T00:00:00+08:00',
        commits: 96,
        positives: 15,
        observedRate: measure(0.15625),
        byPartition: {
          train: { commits: 0, positives: 0 },
          validation: { commits: 40, positives: 7 },
          test: { commits: 56, positives: 8 },
        },
        risk: { count: 56, median: 0.0931, p90: 0.4218, reason: null },
      },
    ],
    ...overrides,
  }
}

/** 含合法聚合键的运行摘要（在既有六字段夹具上加 trendBuckets）。 */
export function trendFixture(trendBuckets: Record<string, unknown> = trendBucketsFixture()) {
  const base = historicalFixture()
  return { ...base, summary: { ...base.summary, trendBuckets } }
}

/** 不含聚合键的既有运行：同一夹具，只是摘要里没有这个键。 */
export function trendFixtureWithoutAggregate() {
  return historicalFixture()
}

/** 稀疏桶（样本低于最小样本）：比例与风险都是空值加原因，仍应可下钻。 */
export function sparseBucket(start: string, end: string, commits = 2) {
  return {
    start,
    end,
    commits,
    positives: 1,
    observedRate: { value: null, reason: `该桶提交数 ${commits} 低于最小样本 20` },
    byPartition: {
      train: { commits, positives: 1 },
      validation: { commits: 0, positives: 0 },
      test: { commits: 0, positives: 0 },
    },
    risk: null,
  }
}

/** 用自定义桶集合替换默认三桶（其余摘要不变），供分区带、下钻与粒度相关用例使用。 */
export function trendFixtureWithBuckets(buckets: unknown[]) {
  return trendFixture({ ...trendBucketsFixture(), buckets })
}

/**
 * 把测试分区对齐到含风险的那个桶（2013-12）。
 *
 * 默认夹具里 `split.test` 只覆盖 2014-01，而含风险分布的桶在 2013-12；要对"风险数据点只落在
 * 测试分区带内"做断言，两者的时间范围必须一致。计数与顺序仍满足既有契约。
 */
export function trendFixtureWithAlignedSplit() {
  const base = trendFixture()
  const summary = base.summary as unknown as { split: Record<string, unknown> }
  summary.split = {
    train: { count: 6, positiveCount: 1, start: '2012-01-01T00:00:00Z', end: '2012-12-31T00:00:00Z' },
    validation: { count: 2, positiveCount: 0, start: '2013-01-01T00:00:00Z', end: '2013-11-30T00:00:00Z' },
    test: { count: 2, positiveCount: 1, start: '2013-12-01T00:00:00Z', end: '2014-01-02T00:00:00Z' },
  }
  return base
}
