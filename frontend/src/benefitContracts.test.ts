import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseBenefitReport } from './benefitContracts'

const raw = JSON.parse(readFileSync(resolve(process.cwd(), '../docs/evidence/benefit-evaluation/baseline/benefit-report.json'), 'utf-8'))

it('parses the frozen baseline benefit report without filling missing metrics', () => {
  const report = parseBenefitReport({ ...raw, reportId: 'benefit-id', source: 'docs/evidence/benefit-evaluation/baseline/benefit-report.json' })
  expect(report.test.records).toBe(1853)
  expect(report.test.positives).toBe(286)
  expect(report.strategies.model.recall20Loc.value).toBeCloseTo(0.04195804195804196)
  expect(report.strategies.time.recall20Loc.value).toBeCloseTo(0.17132867132867133)
  expect(report.strategies.random.runs).toBe(200)
  expect(report.strategies.random.seed).toBe(2026)
  expect(report.strategies.random.recall20Loc.mean).toBeGreaterThan(0)
  expect(report.strategies.random.recall20Loc.std).toBeGreaterThan(0)
  expect(report.conclusion.sentence).toContain('历史标记')
  expect(report.boundary.defectProbability).toBe(false)
  expect(report.limitations.length).toBeGreaterThanOrEqual(4)
  expect(report.existingMetrics?.averagePrecision).toMatchObject({ value: 0.38293951606100585 })
})
import { afterEach, vi } from 'vitest'
import { fetchModelBenefit } from './benefitContracts'
afterEach(() => vi.restoreAllMocks())
it('parses the API envelope with report identity', async () => {
  const body = { available: true, modelId: 'm1', runId: raw.artifact.runId, reportId: 'benefit-id', source: 'docs/evidence/benefit-evaluation/baseline/benefit-report.json', report: raw }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
  const value = await fetchModelBenefit('m1')
  expect(value.available).toBe(true)
  expect(value.report?.artifact.runId).toBe(raw.artifact.runId)
})
