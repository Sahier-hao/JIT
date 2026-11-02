import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fetchMultiProjectReport } from './multiProjectReportContracts'

afterEach(() => vi.restoreAllMocks())

const raw = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/evidence/add-multi-project-training-comparison/multi-project-report.json'), 'utf-8'))

it('parses the frozen four-project report without inventing values', async () => {
  const body = {
    reportId: 'frozen-report', source: 'docs/evidence/add-multi-project-training-comparison/multi-project-report.json',
    status: 'complete', reportStatus: raw.status, generatedUtc: raw.generatedUtc, schema: raw.schema,
    metricSet: raw.metricSet, protocols: raw.protocols, methods: raw.methods,
    projectCount: 4, failedProjectCount: 0, failureCount: 0, methodCount: 5, protocolCount: 4,
    resultCount: 80, partialProtocolCount: 0, completeProtocolCount: 20, failedProtocolCount: 0, error: null,
    report: raw,
  }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
  const detail = await fetchMultiProjectReport('frozen-report')
  expect(detail.report.methods).toHaveLength(5)
  expect(detail.report.projects.map(project => project.name)).toEqual([
    'mp-commons-lang', 'mp-vue-core', 'mp-redis', 'mp-scikit-learn',
  ])
  const local = detail.report.results['logistic-regression-l2-v1'].local
  expect(local.status).toBe('complete')
  expect(local.metrics.averagePrecision.macroMean).toBeCloseTo(0.49528440051850037)
  expect(local.metrics.averagePrecision.populationVariance).toBeCloseTo(0.026845423568523933)
  expect(local.targets).toHaveLength(4)
  expect(local.targets[0].metrics.averagePrecision).toMatchObject({ value: 0.21655973320423746, reason: null })
  const blend = detail.report.results['logistic-regression-l2-v1']['global+local'].targets[0].blend
  expect(blend).toMatchObject({ alphaGlobal: 0.4, alphaLocal: 0.6, selectionData: 'target-validation' })
  expect(blend?.validationBrier).toBeCloseTo(0.09697869493942228)
  expect(detail.report.failures).toEqual([])
  expect(detail.report.boundary.bestMethodDeclared).toBe(false)
})
