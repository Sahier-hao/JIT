import { applyQuery, emptyQuery, type Query } from '../domain'

/**
 * 一个分析结果的界面状态：筛选、分页、详情返回位置。
 *
 * 以前这份状态放在组件里、再用 Map 反向同步回 App（React 看不见的两份副本）；
 * 现在只有一份，由 App 持有，组件通过 `onChange` 提交变更。
 */
export interface ReviewDraft {
  /** 输入框里正在编辑的值。 */
  draft: Query
  /** 已通过校验、实际用于请求的值。 */
  applied: Query
  /** 筛选校验失败的原因；空串表示当前查询有效。 */
  error: string
  /** 当前页的偏移量。 */
  offset: number
  /** 关闭详情后回到哪个视图。 */
  detailReturn: 'commits' | 'plan'
}

export function initialDraft(seed: Query, detailReturn: 'commits' | 'plan'): ReviewDraft {
  return { draft: seed, applied: seed, error: '', offset: 0, detailReturn }
}

/** 编辑筛选：非法输入保留上一次有效查询，并把原因交给界面显示。 */
export function patchQuery(current: ReviewDraft, patch: Partial<Query>): ReviewDraft {
  const draft = { ...current.draft, ...patch }
  const result = applyQuery(current.applied, draft)
  return { ...current, draft, applied: result.query, error: result.error, offset: 0 }
}

export function resetQuery(current: ReviewDraft): ReviewDraft {
  return { ...current, draft: emptyQuery, applied: emptyQuery, error: '', offset: 0 }
}
