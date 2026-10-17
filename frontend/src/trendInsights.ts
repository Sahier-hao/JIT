/**
 * 趋势页的可注册洞察（design D6）。
 *
 * 这里只放**纯函数与大白话文案**，不含任何渲染：页面拿到注册项后只负责把
 * `compute()` 的结果渲染成"结论 + 排名 + 数值"。新增一种洞察时只在这里加一项，
 * 不改页面结构——这是本 change 的可扩展性主缝（design D6/D8）。
 *
 * 口径见 design D4：差异用**率差**（观测正标签比例 − 估计风险），排序用 `|率差|`，
 * 并列按桶起点升序；样本不足的桶由契约给出的空值排除在外，不参与比较。
 */

import type { TrendAggregate, TrendBucket, TrendRisk } from './trendContract'

export interface InsightRankingEntry {
  bucket: TrendBucket
  /** 观测正例数（测试分区）。 */
  observed: number
  /** 估计正例数 = 估计风险 × 测试提交数；来自非期望统计量时是近似值。 */
  estimated: number
  /** 率差 = 观测正标签比例 − 估计风险。 */
  gap: number
}

export type InsightResult =
  | { unavailable: true; reason: string }
  | { unavailable: false; headline: string; approximate: boolean; ranking: InsightRankingEntry[] }

export interface TrendInsight {
  id: string
  kind: string
  label: string
  compute(aggregate: TrendAggregate): InsightResult
}

/** 所有洞察共用的语义边界（design D7）：三要点必须同时出现，且不断言校准结果。 */
export const INSIGHT_DISCLAIMER =
  '以上差异只是诊断信号：风险尚未经过概率校准，观测正标签比例来自发布者历史标签，不代表缺陷率，也不能据此断言模型准确或不准确。'

/** 时区在契约里固定为 UTC+08:00，因此 ISO 串的前 7 位就是该桶所在月份。 */
function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function signedPoints(value: number): string {
  const points = (value * 100).toFixed(1)
  return value >= 0 ? `+${points}` : points
}

/**
 * 估计量择优（design D4）：聚合将来若提供期望风险（`mean`）就用它；
 * 否则退回中位风险，并标记该估计为**近似**（中位数不是期望）。
 */
function pickEstimator(risk: TrendRisk): { value: number; approximate: boolean } | null {
  const mean = (risk as unknown as { mean?: unknown }).mean
  if (typeof mean === 'number' && Number.isFinite(mean) && mean >= 0 && mean <= 1) {
    return { value: mean, approximate: false }
  }
  if (risk.median !== null) return { value: risk.median, approximate: true }
  return null
}

/**
 * 估计与观测的差异。
 *
 * 参与条件由契约的空值表达：观测比例为空（桶样本不足）或风险分布为空（没有测试记录或
 * 测试样本不足）的桶一律排除，**不**当成"差异为零"。
 */
export const observedGapInsight: TrendInsight = {
  id: 'observed-vs-estimated',
  kind: 'gap',
  label: '估计与观测的差异（测试区间）',
  compute(aggregate) {
    const ranking: InsightRankingEntry[] = []
    let approximate = false
    for (const bucket of aggregate.buckets) {
      const observedRate = bucket.observedRate.value
      if (observedRate === null) continue
      const risk = bucket.risk
      if (risk === null) continue
      const testCommits = bucket.byPartition.test.commits
      if (testCommits <= 0) continue
      const estimator = pickEstimator(risk)
      if (estimator === null) continue
      approximate = approximate || estimator.approximate
      ranking.push({
        bucket,
        observed: bucket.byPartition.test.positives,
        estimated: estimator.value * testCommits,
        gap: observedRate - estimator.value,
      })
    }
    if (ranking.length === 0) {
      return {
        unavailable: true,
        reason: '没有桶同时具备观测比例与风险分布（样本不足或不在测试区间的桶不参与比较）。',
      }
    }
    // |率差| 降序；并列按桶起点升序，保证同一份聚合每次得到相同结论。
    ranking.sort(
      (left, right) => Math.abs(right.gap) - Math.abs(left.gap) || Date.parse(left.bucket.start) - Date.parse(right.bucket.start),
    )
    const top = ranking[0]
    const observedRate = top.bucket.observedRate.value ?? 0
    const estimatedRate = observedRate - top.gap
    const headline =
      `差异最显著的是 ${monthOf(top.bucket.start)}：观测正标签比例 ${percent(observedRate)}、` +
      `估计风险 ${percent(estimatedRate)}（差 ${signedPoints(top.gap)} 个百分点）。`
    return { unavailable: false, headline, approximate, ranking }
  },
}

/** 本轮注册的洞察；页面默认渲染这些，测试可注入第二项验证"新增一项不改变既有输出"。 */
export const DEFAULT_INSIGHTS: readonly TrendInsight[] = [observedGapInsight]
