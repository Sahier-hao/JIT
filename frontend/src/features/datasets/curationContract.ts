import { finiteNumber, record, recordList, text, textList } from '@/lib/apiContract'

export interface CurationStats {
  rawRows: number
  includedRows: number
  excludedRows: number
  positiveLabels: number
  timeRange: Record<string, unknown> | null
  excluded: Record<string, unknown>
  sampleExcluded: Record<string, unknown>[]
}

export interface CurationFeatureStats {
  records: number
  present: number
  missing: number
  mean: number | null
  median: number | null
  min: number | null
  max: number | null
  bucketCounts: number[]
}

export interface CurationFeatureComparison {
  field: string
  bins: { start: number; end: number }[]
  before: CurationFeatureStats
  after: CurationFeatureStats
}

export interface CurationRule {
  id: string
  field?: string
  fields?: string[]
  value?: number
  min?: number
  max?: number
  lower?: number
  upper?: number
  start?: string
  end?: string
}

export interface CurationStep {
  index: number
  rule: CurationRule
  details: Record<string, unknown>
  beforeStats: CurationStats
  afterStats: CurationStats
  featureComparison: CurationFeatureComparison[]
}

export interface CurationPreview {
  sourceVersion: string
  recipeSha256: string
  stats: CurationStats
  beforeStats: CurationStats | null
  featureComparison: CurationFeatureComparison[]
  steps: CurationStep[]
}

export const CURATION_RULE_LABELS: Record<string, string> = {
  'drop-duplicates': '删除重复提交',
  'drop-missing': '删除缺失字段',
  'max-value': '数值上限',
  'min-value': '数值下限',
  'keep-range': '保留数值区间',
  'quantile-range': '保留分位区间',
  'keep-date': '保留日期范围',
}

function statsView(raw: unknown): CurationStats {
  const value = record(raw)
  return {
    rawRows: finiteNumber(value.rawRows),
    includedRows: finiteNumber(value.includedRows),
    excludedRows: finiteNumber(value.excludedRows),
    positiveLabels: finiteNumber(value.positiveLabels),
    timeRange: value.timeRange == null ? null : record(value.timeRange),
    excluded: value.excluded == null ? {} : record(value.excluded),
    sampleExcluded: value.sampleExcluded == null ? [] : recordList(value.sampleExcluded),
  }
}

function featureStatsView(value: Record<string, unknown>): CurationFeatureStats {
  return {
    records: finiteNumber(value.records),
    present: finiteNumber(value.present),
    missing: finiteNumber(value.missing),
    mean: value.mean == null ? null : finiteNumber(value.mean),
    median: value.median == null ? null : finiteNumber(value.median),
    min: value.min == null ? null : finiteNumber(value.min),
    max: value.max == null ? null : finiteNumber(value.max),
    bucketCounts: Array.isArray(value.bucketCounts)
      ? value.bucketCounts.map(item => finiteNumber(item))
      : [],
  }
}

function featureComparisonView(raw: unknown): CurationFeatureComparison {
  const value = record(raw)
  return {
    field: text(value.field),
    bins: recordList(value.bins).map(bin => ({
      start: finiteNumber(bin.start),
      end: finiteNumber(bin.end),
    })),
    before: featureStatsView(record(value.before)),
    after: featureStatsView(record(value.after)),
  }
}

function featureComparisonList(raw: unknown): CurationFeatureComparison[] {
  return raw == null ? [] : recordList(raw).map(featureComparisonView)
}

function ruleView(raw: unknown): CurationRule {
  const value = record(raw)
  const optionalText = (key: string) => value[key] == null ? undefined : text(value[key])
  const optionalNumber = (key: string) => value[key] == null ? undefined : finiteNumber(value[key])
  return {
    id: text(value.id),
    field: optionalText('field'),
    fields: value.fields == null ? undefined : textList(value.fields),
    value: optionalNumber('value'),
    min: optionalNumber('min'),
    max: optionalNumber('max'),
    lower: optionalNumber('lower'),
    upper: optionalNumber('upper'),
    start: optionalText('start'),
    end: optionalText('end'),
  }
}

function stepView(raw: unknown): CurationStep {
  const value = record(raw)
  return {
    index: finiteNumber(value.index),
    rule: ruleView(value.rule),
    details: value.details == null ? {} : record(value.details),
    beforeStats: statsView(value.beforeStats),
    afterStats: statsView(value.afterStats),
    featureComparison: featureComparisonList(value.featureComparison),
  }
}

export function parseCurationPreview(raw: unknown): CurationPreview {
  const value = record(raw)
  return {
    sourceVersion: text(value.sourceVersion),
    recipeSha256: text(value.recipeSha256),
    stats: statsView(value.stats),
    beforeStats: value.beforeStats == null ? null : statsView(value.beforeStats),
    featureComparison: featureComparisonList(value.featureComparison),
    steps: value.steps == null ? [] : recordList(value.steps).map(stepView),
  }
}
