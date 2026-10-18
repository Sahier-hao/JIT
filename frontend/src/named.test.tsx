import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import App from './App'
import * as domain from './domain'
import { historicalFixture } from './historical-fixture'
import { namedFixture } from './named-fixture'
import demo from '../public/demo-dataset.json'

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

it('具名形态基线摘要按声明展示，详情与页脚按 schema 生成文案', async () => {
  const user = userEvent.setup()
  render(<App initialMode="historical" loaders={{ historical: async () => namedFixture(), demo: async () => demo }} />)
  await screen.findByRole('button', { name: `查看 ${'1'.repeat(40)}` })
  await user.click(screen.getByText('基线记录', { exact: true }))
  const region = screen.getByRole('region', { name: '基线记录' })
  expect(region).toHaveTextContent('kamei14-v1')
  expect(region).toHaveTextContent('未提供字段：lt（固定快照不含变更前文件规模')
  expect(region).toHaveTextContent('rexp（同名列 rexp 是 Reviewer experience')
  expect(region).toHaveTextContent('logistic-regression-l2-v1')
  expect(region).toHaveTextContent('metric-set-v1')
  expect(region).toHaveTextContent('预测解释未提供')
  expect(region).not.toHaveTextContent('尚非完整 Kamei14')
  await user.click(screen.getByRole('button', { name: `查看 ${'1'.repeat(40)}` }))
  const detail = screen.getByRole('dialog')
  expect(detail).toHaveTextContent('上方度量为当前 schema 声明的原始字段值')
  expect(detail).not.toHaveTextContent('上方六字段')
  expect(detail).not.toHaveTextContent('尚非完整 Kamei14')
  expect(screen.getByText(/历史测试批次 · kamei14-v1 基线/)).toBeVisible()
})
