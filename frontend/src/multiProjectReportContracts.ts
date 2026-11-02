import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, record, recordList, text, textList, textOrNull } from './apiContract'
import type { Row } from './adminContracts'

const REPORT_PATH = '/api/admin/multi-project-reports'
const STATUSES = ['complete', 'partial', 'failed', 'invalid'] as const
export type MultiProjectReportStatus = typeof STATUSES[number]

export interface ReportError { code: string; message: string }
export interface MultiProjectReportSummary {
  reportId: string
  source: string
  status: MultiProjectReportStatus
  reportStatus: string | null
  generatedUtc: string | null
  schema: string | null
  metricSet: string | null
  protocols: string[]
  methods: string[]
  projectCount: number
  failedProjectCount: number
  failureCount: number
  methodCount: number
  protocolCount: number
  resultCount: number
  partialProtocolCount: number
  completeProtocolCount: number
  failedProtocolCount: number
  error: ReportError | null
}
export interface ReportPartition {
  count: number | null
  positiveCount: number | null
  firstEpoch: number | null
  lastEpoch: number | null
  idDigest: string | null
}
export interface ReportFailure {
  status: string | null
  stage: string | null
  code: string | null
  message: string | null
  method: string | null
  protocol: string | null
  project: string | null
  trainingProjects: string[]
}
export interface ReportProject {
  name: string
  dataset: string | null
  version: string | null
  status: string
  failure: ReportFailure | null
  includedRows: number | null
  positiveLabels: number | null
  schema: string | null
  url: string | null
  revision: string | null
  labelRule: string | null
  limitations: string[]
  partitions: Record<string, ReportPartition>
}
export interface ReportBlend {
  alphaGlobal: number
  alphaLocal: number
  validationCount: number | null
  validationPositiveCount: number | null
  validationBrier: number | null
  selectionData: string | null
}
export interface ReportTarget {
  project: string
  status: string
  trainingProjects: string[]
  trainingSeconds: number | null
  metrics: Row
  targetTest: ReportPartition | null
  blend: ReportBlend | null
  failure: ReportFailure | null
}
export interface ReportAggregate {
  direction: string | null
  definedCount: number | null
  macroMean: number | null
  populationVariance: number | null
  worstProject: { project: string; value: number } | null
  undefined: { project: string; reason: string }[]
}
export interface ReportProtocol {
  status: string
  targets: ReportTarget[]
  metrics: Record<string, ReportAggregate>
  worstProjectByPrimaryMetric: { metric: string | null; project: string | null; value: number | null }
}
export interface MultiProjectReport {
  kind: string
  reportVersion: number
  generatedUtc: string
  schema: string
  metricSet: string
  protocols: string[]
  methods: string[]
  projects: ReportProject[]
  failures: ReportFailure[]
  results: Record<string, Record<string, ReportProtocol>>
  boundary: Row
  environment: Row
  sourceCode: Row
}
export interface MultiProjectReportDetail extends MultiProjectReportSummary { report: MultiProjectReport }

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function errorOrNull(value: unknown): ReportError | null {
  if (value === null || value === undefined) return null
  const item = record(value)
  return { code: text(item.code), message: text(item.message) }
}
function parsePartition(raw: unknown): ReportPartition {
  const value = record(raw)
  return {
    count: numberOrNull(value.count), positiveCount: numberOrNull(value.positiveCount),
    firstEpoch: numberOrNull(value.firstEpoch), lastEpoch: numberOrNull(value.lastEpoch),
    idDigest: textOrNull(value.idDigest),
  }
}
function parseFailure(raw: unknown): ReportFailure {
  const value = record(raw)
  return {
    status: textOrNull(value.status), stage: textOrNull(value.stage), code: textOrNull(value.code),
    message: textOrNull(value.message), method: textOrNull(value.method),
    protocol: textOrNull(value.protocol), project: textOrNull(value.project),
    trainingProjects: value.trainingProjects === undefined ? [] : textList(value.trainingProjects),
  }
}
function parseProject(raw: unknown): ReportProject {
  const value = record(raw)
  const partitions = record(value.partitions ?? {})
  return {
    name: text(value.name), dataset: textOrNull(value.dataset), version: textOrNull(value.version),
    status: text(value.status ?? 'unknown'),
    failure: value.failure === null || value.failure === undefined ? null : parseFailure(value.failure),
    includedRows: numberOrNull(value.includedRows), positiveLabels: numberOrNull(value.positiveLabels),
    schema: textOrNull(value.schema), url: textOrNull(value.url), revision: textOrNull(value.revision),
    labelRule: typeof value.labelSemantics === 'object' && value.labelSemantics !== null
      ? textOrNull(record(value.labelSemantics).rule) : null,
    limitations: typeof value.labelSemantics === 'object' && value.labelSemantics !== null
      ? textList(record(value.labelSemantics).limitations ?? []) : [],
    partitions: Object.fromEntries(Object.entries(partitions).map(([name, part]) => [name, parsePartition(part)])),
  }
}
function parseBlend(raw: unknown): ReportBlend | null {
  if (raw === null || raw === undefined) return null
  const value = record(raw)
  return {
    alphaGlobal: finiteNumber(value.alphaGlobal), alphaLocal: finiteNumber(value.alphaLocal),
    validationCount: numberOrNull(value.validationCount),
    validationPositiveCount: numberOrNull(value.validationPositiveCount),
    validationBrier: numberOrNull(value.validationBrier), selectionData: textOrNull(value.selectionData),
  }
}
function parseTarget(raw: unknown): ReportTarget {
  const value = record(raw)
  const metrics = value.metrics === undefined ? {} : record(value.metrics)
  return {
    project: text(value.project), status: text(value.status ?? 'unknown'),
    trainingProjects: value.trainingProjects === undefined ? [] : textList(value.trainingProjects),
    trainingSeconds: numberOrNull(value.trainingSeconds), metrics,
    targetTest: value.targetTest === undefined ? null : parsePartition(value.targetTest),
    blend: parseBlend(value.blend),
    failure: value.failure === null || value.failure === undefined ? null : parseFailure(value.failure),
  }
}
function aggregate(raw: unknown): ReportAggregate {
  const value = record(raw)
  const worst = value.worstProject === null || value.worstProject === undefined ? null : record(value.worstProject)
  return {
    direction: textOrNull(value.direction), definedCount: numberOrNull(value.definedCount),
    macroMean: numberOrNull(value.macroMean), populationVariance: numberOrNull(value.populationVariance),
    worstProject: worst === null ? null : { project: text(worst.project), value: finiteNumber(worst.value) },
    undefined: value.undefined === undefined ? [] : recordList(value.undefined).map(item => ({
      project: text(item.project), reason: textOrNull(item.reason) ?? '指标未定义',
    })),
  }
}
function parseProtocol(raw: unknown): ReportProtocol {
  const value = record(raw)
  const summary = record(value.summary ?? {})
  const metrics = record(summary.metrics ?? {})
  const worst = record(summary.worstProjectByPrimaryMetric ?? {})
  return {
    status: text(value.status),
    targets: value.targets === undefined ? [] : recordList(value.targets).map(parseTarget),
    metrics: Object.fromEntries(Object.entries(metrics).map(([name, entry]) => [name, aggregate(entry)])),
    worstProjectByPrimaryMetric: { metric: textOrNull(worst.metric), project: textOrNull(worst.project), value: numberOrNull(worst.value) },
  }
}

export function parseMultiProjectReportSummary(raw: unknown): MultiProjectReportSummary {
  const value = record(raw)
  if (!STATUSES.includes(value.status as MultiProjectReportStatus)) contractFailed('报告状态未登记')
  return {
    reportId: text(value.reportId), source: text(value.source),
    status: value.status as MultiProjectReportStatus, reportStatus: textOrNull(value.reportStatus),
    generatedUtc: textOrNull(value.generatedUtc), schema: textOrNull(value.schema), metricSet: textOrNull(value.metricSet),
    protocols: textList(value.protocols), methods: textList(value.methods),
    projectCount: finiteNumber(value.projectCount), failedProjectCount: finiteNumber(value.failedProjectCount),
    failureCount: finiteNumber(value.failureCount), methodCount: finiteNumber(value.methodCount),
    protocolCount: finiteNumber(value.protocolCount), resultCount: finiteNumber(value.resultCount),
    partialProtocolCount: finiteNumber(value.partialProtocolCount),
    completeProtocolCount: finiteNumber(value.completeProtocolCount),
    failedProtocolCount: finiteNumber(value.failedProtocolCount),
    error: errorOrNull(value.error),
  }
}

function parseDetail(raw: unknown, reportId: string): MultiProjectReportDetail {
  const body = record(raw)
  if (body.reportId !== reportId) contractFailed('报告标识与请求不一致')
  const report = record(body.report)
  if (report.kind !== 'multi-project-training-report') contractFailed('报告类型不一致')
  const results = record(report.results)
  const parsed: Record<string, Record<string, ReportProtocol>> = {}
  for (const [method, protocols] of Object.entries(results)) {
    const group = record(protocols)
    parsed[method] = Object.fromEntries(Object.entries(group).map(([name, value]) => [name, parseProtocol(value)]))
  }
  return {
    ...parseMultiProjectReportSummary(body),
    report: {
      kind: text(report.kind), reportVersion: finiteNumber(report.reportVersion),
      generatedUtc: text(report.generatedUtc), schema: text(report.schema), metricSet: text(report.metricSet),
      protocols: textList(report.protocols), methods: textList(report.methods),
      projects: recordList(report.projects).map(parseProject),
      failures: recordList(report.failures).map(parseFailure),
      results: parsed, boundary: record(report.boundary), environment: record(report.environment),
      sourceCode: record(report.sourceCode),
    },
  }
}

export async function fetchMultiProjectReports(signal?: AbortSignal) {
  const body = record(await apiRequest({ path: REPORT_PATH, method: 'GET', signal }))
  return { reports: recordList(body.reports).map(parseMultiProjectReportSummary), total: finiteNumber(body.total) }
}
export async function fetchMultiProjectReport(reportId: string, signal?: AbortSignal) {
  return parseDetail(await apiRequest({ path: `${REPORT_PATH}/${encodeURIComponent(reportId)}`, method: 'GET', signal }), reportId)
}
