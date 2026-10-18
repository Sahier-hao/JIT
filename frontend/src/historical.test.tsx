import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import * as domain from './domain'
import { historicalFixture } from './historical-fixture'
import { restoreShortlist, saveShortlist, storageKey } from './shortlist'
import App from './App'
import demo from '../public/demo-dataset.json'

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

it('默认真实模式，基线记录与详情不冒用人工解释，过滤不重算指标', async () => {
  const user = userEvent.setup()
  render(<App initialMode="historical" loaders={{ historical: async () => historicalFixture(), demo: async () => demo }} />)
  await screen.findByRole('button', { name: `查看 ${'1'.repeat(40)}` })
  await user.click(screen.getByText('基线记录', { exact: true }))
  expect(screen.getByRole('region', { name: '基线记录' })).toHaveTextContent('完整冻结测试批次')
  expect(screen.getByRole('region', { name: '基线记录' })).toHaveTextContent('无法计算：没有预测为正的提交')
  await user.type(screen.getByLabelText('提交标识搜索'), '1111')
  expect(screen.getAllByRole('row')).toHaveLength(2)
  expect(screen.getByRole('region', { name: '基线记录' })).toHaveTextContent('2 条测试提交')
  await user.click(screen.getByRole('button', { name: `查看 ${'1'.repeat(40)}` }))
  const detail = screen.getByRole('dialog')
  expect(detail).toHaveTextContent('预测解释未提供')
  expect(detail).toHaveTextContent('ent')
  expect(detail).not.toHaveTextContent('人工说明')
  await user.click(screen.getByRole('button', { name: '交互演示' }))
  await screen.findByRole('button', { name: '查看 demo-0001' })
  expect(screen.queryByRole('region', { name: '基线记录' })).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('加载中可切换，晚到的真实结果不会覆盖演示', async () => {
  const user = userEvent.setup()
  let resolve!: (value: unknown) => void
  const pending = new Promise<unknown>(done => { resolve = done })
  render(<App initialMode="historical" loaders={{ historical: () => pending, demo: async () => demo }} />)
  expect(screen.getByText('正在读取实验来源')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '交互演示' }))
  await screen.findByRole('button', { name: '查看 demo-0001' })
  await act(async () => resolve(historicalFixture()))
  expect(screen.queryByRole('button', { name: `查看 ${'1'.repeat(40)}` })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看 demo-0001' })).toBeVisible()
})

it('具名历史运行在服务切换后明确拒绝替换，显式切换后计划仍按运行隔离', async () => {
  const user = userEvent.setup()
  const a = async () => historicalFixture()
  const b = async () => historicalFixture('d'.repeat(64))
  const first = '1'.repeat(40), second = '0'.repeat(40)
  const app = render(<App initialMode="historical" loaders={{ historical: a }} />)
  await user.click(await screen.findByRole('button', { name: `加入 ${first} 到清单` }))
  await user.click(screen.getByRole('button', { name: `查看 ${first}` }))
  app.rerender(<App initialMode="historical" loaders={{ historical: b }} />)
  expect(await screen.findByText('该历史运行未供给')).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '查看当前供给运行' }))
  await user.click(await screen.findByRole('button', { name: `加入 ${second} 到清单` }))
  expect(screen.getByRole('button', { name: `加入 ${first} 到清单` })).toBeEnabled()
  app.rerender(<App initialMode="historical" loaders={{ historical: a }} />)
  await screen.findByText('该历史运行未供给')
  await user.click(screen.getByRole('button', { name: '查看当前供给运行' }))
  expect(await screen.findByRole('button', { name: `${first} 已在清单` })).toBeDisabled()
  expect(screen.getByRole('button', { name: `加入 ${second} 到清单` })).toBeEnabled()
})

it('真实失败不回退，恢复可重试，两模式入口一直可用', async () => {
  const user = userEvent.setup()
  let failed = true
  render(<App initialMode="historical" loaders={{ historical: async () => { if (failed) throw new Error('模型产物不可用'); return historicalFixture() }, demo: async () => demo }} />)
  await screen.findByText('实验数据不可用')
  expect(screen.getByRole('alert')).toHaveTextContent('模型产物不可用')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '交互演示' })).toBeEnabled()
  failed = false
  await user.click(screen.getByRole('button', { name: '重新加载' }))
  const trigger = await screen.findByRole('button', { name: `查看 ${'1'.repeat(40)}` })
  const row = trigger.closest('tr')!
  expect(within(row).getByText('0.75')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
