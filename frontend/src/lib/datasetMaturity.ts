const LABEL_STATUS_LABELS: Record<string, string> = {
  positive: '正例', immature: '未成熟', unobserved: '观察后未见修复', unknown: '状态未知',
}

function countOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

/** 用户端与管理端共用的标签成熟状态条目。 */
export function labelMaturityItems(statusCounts: Record<string, unknown> | null | undefined): { label: string; value: number }[] {
  if (!statusCounts) return []
  return Object.entries(statusCounts).flatMap(([key, value]) => {
    const count = countOf(value)
    return count == null ? [] : [{ label: LABEL_STATUS_LABELS[key] ?? key, value: count }]
  })
}

/** 一行式成熟摘要；不可用时显示原因，不伪造零值。 */
export function labelMaturityText(maturity: { available?: unknown; statusCounts?: unknown; reason?: unknown } | null | undefined): string {
  if (maturity?.available !== true) {
    return typeof maturity?.reason === 'string' && maturity.reason ? maturity.reason : '成熟状态未记录'
  }
  const items = labelMaturityItems((maturity.statusCounts ?? null) as Record<string, unknown> | null)
  return items.length ? items.map(item => `${item.label} ${item.value}`).join(' · ') : '成熟状态未记录'
}
