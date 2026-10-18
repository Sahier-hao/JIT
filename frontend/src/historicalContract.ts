import { parseDataset, validRisk, type Dataset } from './domain'

export type Mode = 'demo' | 'historical' | 'repository'
export interface Score { value: number | null; reason: string | null }
interface Classification { precision: Score; recall: Score; f1: Score; confusion: { tp: number; fp: number; tn: number; fn: number } }
interface BaselineMetrics extends Classification {
  rocAuc: Score; averagePrecision: Score; recall20Loc: Score; threshold: number;
  counts: { records: number; positive: number; negative: number };
  effort: { name: string; totalLoc: number; budgetLoc: number; usedLoc: number; selectedCount: number; ordering: string; policy: string };
  reference: { apNoInformation: number; allNegative: Classification };
}
export interface BaselineSummary {
  runId: string; datasetVersion: string; modelSha256: string; features: string[]; threshold: number; protocolVersion: string; limitations: string[];
  featureSchema: { name: string; inModel: string[]; unavailable: { name: string; reason: string }[] } | null;
  algorithmVersion: string | null; metricSet: string | null;
  model: { id: string; name: string } | null;
  source: { publisher: string; revision: string; url: string; sha256: string; citation: string; labelRule: string;
    files: Record<string, { url: string; sha256: string; bytes: number }>;
    quality: { rawRows: number; includedRows: number; positiveLabels: number; blankLabels: number; excluded: Record<string, number> } };
  cohort: Record<string, number>;
  split: Record<'train' | 'validation' | 'test', { count: number; positiveCount: number; start: string; end: string }>;
  metrics: BaselineMetrics;
}
const features = ['ns', 'nd', 'nf', 'ent', 'la', 'ld']
function requireCondition(ok: unknown): asserts ok { if (!ok) throw new Error('真实来源、模型或基线记录不一致，数据不可用') }
function object(value: unknown): Record<string, unknown> { requireCondition(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown> }
function text(value: unknown): asserts value is string { requireCondition(typeof value === 'string' && !!value.trim()) }
function hash(value: unknown) { requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) }
function count(value: unknown): asserts value is number { requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) }
function nonnegative(value: unknown): asserts value is number { requireCondition(typeof value === 'number' && Number.isFinite(value) && value >= 0) }
function score(value: unknown) {
  const entry = object(value)
  if (entry.value === null) text(entry.reason)
  else { requireCondition(validRisk(entry.value)); requireCondition(entry.reason === null) }
}
function classification(value: unknown) {
  const entry = object(value)
  for (const name of ['precision', 'recall', 'f1']) score(entry[name])
  const confusion = object(entry.confusion)
  for (const name of ['tp', 'fp', 'tn', 'fn']) count(confusion[name])
}
function orderedFeatures(value: unknown) { requireCondition(Array.isArray(value) && JSON.stringify(value) === JSON.stringify(features)) }
function url(value: unknown) { text(value); requireCondition(value.startsWith('https://')) }

// 阶段一：两形态共享的信封校验（D7）——契约版本、身份、来源、分区、指标、记录身份。
function parseEnvelope(raw: Record<string, unknown>): { parsed: Dataset; test: Record<string, unknown> } {
  requireCondition(raw.contractVersion === 1 && raw.mode === 'historical')
  hash(raw.runId); text(raw.datasetVersion); requireCondition(raw.version === raw.datasetVersion)
  const model = object(raw.model)
  text(model.id); text(model.name); hash(model.sha256)
  const summary = object(raw.summary)
  requireCondition(summary.runId === raw.runId && summary.datasetVersion === raw.datasetVersion && summary.modelSha256 === model.sha256)
  requireCondition(summary.threshold === .5); text(summary.protocolVersion)
  requireCondition(Array.isArray(summary.limitations) && summary.limitations.length > 0); summary.limitations.forEach(text)
  const source = object(summary.source)
  for (const name of ['publisher', 'revision', 'citation', 'labelRule']) text(source[name])
  hash(source.sha256); url(source.url)
  const files = object(source.files)
  for (const name of ['openstack.csv', 'load_data.r', 'experimental_settings.r']) {
    const file = object(files[name]); url(file.url); hash(file.sha256); count(file.bytes)
  }
  requireCondition(object(files['openstack.csv']).sha256 === source.sha256)
  const quality = object(source.quality)
  for (const name of ['rawRows', 'includedRows', 'positiveLabels', 'blankLabels']) count(quality[name])
  const excluded = object(quality.excluded)
  Object.values(excluded).forEach(count)
  requireCondition((quality.includedRows as number) + Object.values(excluded).reduce<number>((sum, x) => sum + (x as number), 0) === quality.rawRows)
  const cohort = object(summary.cohort)
  for (const name of ['startEpochInclusive', 'endEpochExclusive', 'addedLinesGreaterThan', 'maxChurnInclusive', 'maxFilesInclusive']) count(cohort[name])
  const split = object(summary.split)
  for (const name of ['train', 'validation', 'test']) {
    const part = object(split[name]); count(part.count); count(part.positiveCount)
    requireCondition((part.positiveCount as number) <= (part.count as number))
    text(part.start); text(part.end)
    requireCondition(Number.isFinite(Date.parse(part.start)) && Number.isFinite(Date.parse(part.end)) && Date.parse(part.start) <= Date.parse(part.end))
  }
  const train = object(split.train), validation = object(split.validation), test = object(split.test)
  requireCondition(Date.parse(train.end as string) < Date.parse(validation.start as string) && Date.parse(validation.end as string) < Date.parse(test.start as string))
  requireCondition((train.count as number) + (validation.count as number) + (test.count as number) === quality.includedRows)
  const metrics = object(summary.metrics)
  classification(metrics)
  for (const name of ['rocAuc', 'averagePrecision', 'recall20Loc']) score(metrics[name])
  requireCondition(metrics.threshold === summary.threshold)
  const counts = object(metrics.counts), confusion = object(metrics.confusion)
  for (const name of ['records', 'positive', 'negative']) count(counts[name])
  requireCondition(counts.records === test.count && counts.positive === test.positiveCount && (counts.positive as number) + (counts.negative as number) === counts.records)
  requireCondition((confusion.tp as number) + (confusion.fn as number) === counts.positive && (confusion.tn as number) + (confusion.fp as number) === counts.negative)
  const effort = object(metrics.effort)
  requireCondition(effort.name === 'Recall@20%LOC (risk-ranked)' && effort.ordering === 'risk-desc,time-desc,id-asc' && effort.policy === 'whole-commit-prefix-stop')
  for (const name of ['totalLoc', 'budgetLoc', 'usedLoc']) nonnegative(effort[name])
  count(effort.selectedCount)
  requireCondition(Math.abs((effort.budgetLoc as number) - .2 * (effort.totalLoc as number)) <= 1e-8 && (effort.usedLoc as number) <= (effort.budgetLoc as number) && (effort.selectedCount as number) <= (counts.records as number))
  const reference = object(metrics.reference)
  requireCondition(validRisk(reference.apNoInformation)); classification(reference.allNegative)
  const parsed = parseDataset({ project: raw.project, version: raw.version, records: raw.records })
  requireCondition(parsed.records.length === test.count && Array.isArray(raw.records))
  raw.records.forEach(item => {
    const r = object(item)
    requireCondition(!('label' in r) && !('title' in r) && !('explanation' in r))
    requireCondition(typeof r.id === 'string' && /^[a-f0-9]{40}$/.test(r.id) && validRisk(r.risk))
    requireCondition(Date.parse(r.time as string) >= Date.parse(test.start as string) && Date.parse(r.time as string) <= Date.parse(test.end as string))
  })
  return { parsed, test }
}

// 阶段二 · 旧形态：现有六字段与 6 键校验逐行保留（CRR-14 零回退）。
function legacyForm(summary: Record<string, unknown>, records: unknown[]): BaselineSummary {
  orderedFeatures(summary.features)
  records.forEach(item => {
    const r = object(item), measures = object(r.metrics)
    requireCondition(Object.keys(measures).length === 6)
    for (const name of features) { if (name === 'ent') nonnegative(measures[name]); else count(measures[name]) }
    requireCondition(r.lines === (measures.la as number) + (measures.ld as number) && r.files === measures.nf)
  })
  return { ...(summary as unknown as BaselineSummary), featureSchema: null, algorithmVersion: null, metricSet: null, model: null }
}

// 阶段二 · 具名形态：按声明 schema 与方法校验（D3）。字段顺序由声明决定，
// features 信息上冗余于 inModel——它的存在价值正是作为一致性校验对象。
function namedForm(summary: Record<string, unknown>, modelId: unknown, records: unknown[]): BaselineSummary {
  const schema = object(summary.featureSchema)
  text(schema.name); requireCondition(summary.protocolVersion === schema.name)
  requireCondition(Array.isArray(schema.inModel) && schema.inModel.length > 0)
  schema.inModel.forEach(text)
  requireCondition(JSON.stringify(summary.features) === JSON.stringify(schema.inModel))
  requireCondition(Array.isArray(schema.unavailable))
  const unavailableNames = new Set<string>()
  const unavailable = schema.unavailable.map(entry => {
    const field = object(entry); text(field.name); text(field.reason)
    requireCondition(!unavailableNames.has(field.name as string)); unavailableNames.add(field.name as string)
    requireCondition(!(schema.inModel as string[]).includes(field.name as string))
    return { name: field.name as string, reason: field.reason as string }
  })
  const declared = schema.inModel as string[]
  records.forEach(item => {
    const r = object(item), measures = object(r.metrics)
    requireCondition(Object.keys(measures).length === declared.length && declared.every(name => name in measures))
    declared.forEach(name => nonnegative(measures[name]))
    if (declared.includes('la') && declared.includes('ld')) requireCondition(r.lines === (measures.la as number) + (measures.ld as number))
    if (declared.includes('nf')) requireCondition(r.files === measures.nf)
  })
  const model = object(summary.model)
  text(model.id); text(model.name); requireCondition(model.id === modelId)
  text(summary.algorithmVersion); text(summary.metricSet)
  return { ...(summary as unknown as BaselineSummary),
    featureSchema: { name: schema.name as string, inModel: declared, unavailable },
    algorithmVersion: summary.algorithmVersion as string, metricSet: summary.metricSet as string,
    model: { id: model.id as string, name: model.name as string } }
}

export function parseHistorical(input: unknown): Dataset {
  const raw = object(input)
  const envelope = parseEnvelope(raw)
  const summary = object(raw.summary)
  // 形态分派唯一依据：字段声明的存在性（D1），不是契约版本号。
  const checked = 'featureSchema' in summary ? namedForm(summary, object(raw.model).id, raw.records as unknown[]) : legacyForm(summary, raw.records as unknown[])
  // Return metadata only after the complete required contract has been checked.
  return { ...envelope.parsed, mode: 'historical', runId: raw.runId as string,
    model: object(raw.model) as unknown as Dataset['model'], summary: checked }
}
