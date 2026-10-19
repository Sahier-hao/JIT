import { beforeEach, expect, it, vi } from 'vitest'
import * as domain from './domain'
import { historicalFixture } from './historical-fixture'
import { restoreShortlist, saveShortlist, storageKey } from './shortlist'
import demo from './fixtures/demo-dataset.json'

beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/') })

it('真实契约验证完整身份和六字段，不含逐条标签与解释', () => {
  const parsed = domain.parseHistorical(historicalFixture())
  expect(parsed.mode).toBe('historical')
  expect(parsed.records[1].metrics).toEqual(historicalFixture().records[1].metrics)
  expect(parsed.summary?.runId).toBe(parsed.runId)
})

it.each(['run', 'model', 'count', 'features', 'risk', 'raw', 'label', 'summary', 'metric', 'time'])('拒绝不一致的真实来源 %s', name => {
  const input = historicalFixture()
  if (name === 'run') input.summary.runId = 'd'.repeat(64)
  if (name === 'model') input.summary.modelSha256 = 'd'.repeat(64)
  if (name === 'count') input.summary.split.test.count = 3
  if (name === 'features') input.summary.features.reverse()
  if (name === 'risk') input.records[0].risk = -1
  if (name === 'raw') input.records[0].lines = 999
  if (name === 'label') Object.assign(input.records[0], { label: 1 })
  if (name === 'summary') Object.assign(input, { summary: undefined })
  if (name === 'metric') input.summary.metrics.precision = { value: null, reason: null }
  if (name === 'time') input.records[0].time = '2012-01-01T00:00:00Z'
  expect(() => domain.parseHistorical(input)).toThrow()
})

it('演示清单兼容v1，真实同标识两个运行隔离并保留恢复', () => {
  const a = domain.parseHistorical(historicalFixture())
  const b = domain.parseHistorical(historicalFixture('d'.repeat(64)))
  const d = domain.parseDataset({ ...demo, records: a.records })
  expect(storageKey(d)).toContain('jit-review:plan:v3:')
  saveShortlist(a, [a.records[0].id])
  saveShortlist(d, [a.records[1].id])
  expect(restoreShortlist(b).ids).toEqual([])
  expect(restoreShortlist(d).ids).toEqual([a.records[1].id])
  expect(restoreShortlist(a).ids).toEqual([a.records[0].id])
  expect(storageKey(a)).not.toBe(storageKey(b))
})
