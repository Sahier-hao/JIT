/** 数据来源模式：历史回放（发布者标签）与仓库分析（本次同步打分）。 */
export type Mode = 'demo' | 'historical' | 'repository'

/** 指标格子：可计算时为数值，否则带一句不可用原因（不填 0 冒充）。 */
export interface Score {
  value: number | null
  reason: string | null
}
