import { beforeEach, expect, it } from 'vitest'
import * as domain from './domain'
import { historicalFixture } from './historical-fixture'
import { namedFixture } from './named-fixture'

beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/') })

it('具名形态按声明解析：schema、12 入模字段键与模型标识', () => {
  const parsed = domain.parseHistorical(namedFixture())
  expect(parsed.mode).toBe('historical')
  expect(parsed.summary?.featureSchema?.name).toBe('kamei14-v1')
  expect(parsed.summary?.featureSchema?.inModel).toHaveLength(12)
  expect(parsed.summary?.algorithmVersion).toBe('logistic-regression-l2-v1')
  expect(parsed.summary?.metricSet).toBe('metric-set-v1')
  expect(parsed.summary?.model?.id).toBe('logistic-regression-kamei14-v1')
  expect(Object.keys(parsed.records[0].metrics!)).toHaveLength(12)
  expect(parsed.records[0].metrics).toHaveProperty('entropy')
  expect(parsed.records[0].metrics).not.toHaveProperty('ent')
})

it.each(['features', 'protocol', 'unavailable', 'model', 'key', 'value'])('拒绝不一致的具名来源 %s', name => {
  const input = namedFixture()
  if (name === 'features') input.summary.features.reverse()
  if (name === 'protocol') input.summary.protocolVersion = 'openstack-six-v1'
  if (name === 'unavailable') input.summary.featureSchema.unavailable[0].reason = ''
  if (name === 'model') input.summary.model.id = 'logistic-regression-six-v1'
  if (name === 'key') delete input.records[0].metrics.nuc
  if (name === 'value') input.records[0].metrics.nuc = -1
  expect(() => domain.parseHistorical(input)).toThrow()
})

it('旧形态夹具仍按旧口径通过，且不产生具名声明字段', () => {
  const parsed = domain.parseHistorical(historicalFixture())
  expect(parsed.summary?.featureSchema).toBeNull()
  expect(parsed.summary?.algorithmVersion).toBeNull()
  expect(parsed.summary?.model).toBeNull()
})
