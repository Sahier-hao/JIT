import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'
import App from './App'
import demo from '../public/demo-dataset.json'
import { emptyQuery, readSeedQuery } from './domain'

/**
 * 地址上的日期是工作台的"查询种子"（CRR-05，change `make-trend-actionable`）：
 * 只在挂载时读取一次，手动修改不写回地址，因此刷新会回到地址给定的范围。
 */

const loader = async () => demo
const dataRows = () => screen.getAllByRole('row').length - 1

beforeEach(() => {
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

it('种子解析：合法、单侧、非法、颠倒与未知键', () => {
  expect(readSeedQuery('')).toEqual({ query: emptyQuery, ignored: false })
  expect(readSeedQuery('?start=2026-10-08&end=2026-10-09').query).toMatchObject({
    start: '2026-10-08', end: '2026-10-09', search: '', sort: 'risk',
  })
  expect(readSeedQuery('?start=2026-10-08').query).toMatchObject({ start: '2026-10-08', end: '' })
  expect(readSeedQuery('?end=2026-10-09').query).toMatchObject({ start: '', end: '2026-10-09' })
  expect(readSeedQuery('?start=2026-10-0x')).toEqual({ query: emptyQuery, ignored: true })
  expect(readSeedQuery('?start=2026-10-09&end=2026-10-02')).toEqual({ query: emptyQuery, ignored: true })
  expect(readSeedQuery('?sort=time&mode=demo')).toEqual({ query: emptyQuery, ignored: false })
})

it('带种子的地址按范围筛选，搜索为空、排序保持默认', async () => {
  window.history.pushState({}, '', '/?start=2026-10-08&end=2026-10-09')
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0001' })
  expect(dataRows()).toBe(3)
  expect(screen.getByLabelText('起始日期')).toHaveValue('2026-10-08')
  expect(screen.getByLabelText('结束日期')).toHaveValue('2026-10-09')
  expect(screen.getByLabelText('提交标识搜索')).toHaveValue('')
  expect(screen.getByLabelText('排序')).toHaveValue('risk')
})

it('非法种子整体忽略并说明，不占用日期错误区', async () => {
  window.history.pushState({}, '', '/?start=2026-10-09&end=2026-10-02')
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0001' })
  expect(dataRows()).toBe(12)
  expect(screen.getByRole('status')).toHaveTextContent('地址中的日期范围无效，已忽略')
  expect(screen.queryByText(/请修正日期范围/)).not.toBeInTheDocument()
  expect(screen.getByLabelText('起始日期')).toHaveValue('')
  expect(screen.getByLabelText('结束日期')).toHaveValue('')
})

it('手动修改后重新挂载回到种子范围，清单不受筛选影响', async () => {
  const user = userEvent.setup()
  window.history.pushState({}, '', '/?start=2026-10-08&end=2026-10-09')
  const first = render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '加入 demo-0001 到清单' })
  await user.click(screen.getByRole('button', { name: '加入 demo-0001 到清单' }))
  await user.clear(screen.getByLabelText('结束日期'))
  await user.type(screen.getByLabelText('结束日期'), '2026-10-10')
  expect(dataRows()).toBe(4)
  first.unmount()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: 'demo-0001 已在清单' })
  expect(screen.getByLabelText('结束日期')).toHaveValue('2026-10-09')
  expect(dataRows()).toBe(3)
  expect(screen.getByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
})

it('演示模式与历史模式同样按种子范围筛选（范围与来源无关）', async () => {
  window.history.pushState({}, '', '/?mode=demo&start=2026-10-04&end=2026-10-05')
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0007' })
  // 2026-10-04T17:00 +08:00 与 2026-10-05T08:45 +08:00 两条
  expect(dataRows()).toBe(2)
  expect(screen.getByLabelText('起始日期')).toHaveValue('2026-10-04')
})
