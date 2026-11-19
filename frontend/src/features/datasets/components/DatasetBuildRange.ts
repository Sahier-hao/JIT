export type DatasetBuildRangeMode = 'all' | '1y' | '90d' | 'custom'

export function dateDaysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export function buildWindowForRange(mode: DatasetBuildRangeMode, since: string, until: string) {
  if (mode === '1y') return { since: dateDaysAgo(365) }
  if (mode === '90d') return { since: dateDaysAgo(90) }
  if (mode === 'custom') return { ...(since ? { since } : {}), ...(until ? { until } : {}) }
  return {}
}

export function rangeIsValid(mode: DatasetBuildRangeMode, since: string, until: string) {
  return mode !== 'custom' || Boolean(since || until)
}
