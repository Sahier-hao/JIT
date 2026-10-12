import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { CommitDetail } from './CommitDetail'
import demo from '../public/demo-dataset.json'
import { parseDataset } from './domain'
import { storageKey } from './shortlist'

const loader = async () => demo
const row = (id: string) => screen.getByRole('row', { name: new RegExp(id) })
beforeEach(() => { vi.restoreAllMocks(); window.localStorage.clear() })

it('CRR-01/02/03 明示来源与边界，缺失度量不填零', async () => {
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0003' })
  expect(screen.getByText('演示模式')).toBeVisible()
  expect(screen.getByText('demo-v1')).toBeVisible()
  expect(within(row('demo-0003')).getByText('100%')).toBeVisible()
  expect(within(row('demo-0009')).getByText('0%')).toBeVisible()
  expect(within(row('demo-0010')).getByText('暂无预测')).toBeVisible()
  expect(within(row('demo-0011')).getByText('未提供')).toBeVisible()
})

it('CRR-04/05 无结果可清除，无效日期保留有效结果', async () => {
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0001' })
  await user.type(screen.getByLabelText('提交标识搜索'), ' DEMO-0001 ')
  expect(screen.getAllByRole('row')).toHaveLength(2)
  await user.type(screen.getByLabelText('起始日期'), '2026-10-09')
  await user.type(screen.getByLabelText('结束日期'), '2026-10-02')
  expect(screen.getByRole('alert')).toHaveTextContent('日期')
  await user.click(screen.getByRole('button', { name: '清除筛选' }))
  await user.type(screen.getByLabelText('提交标识搜索'), 'missing')
  expect(screen.getByText('没有符合条件的提交')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '清除筛选' }))
  expect(screen.getAllByRole('row')).toHaveLength(13)
})

it('CRR-07/08 列表、详情与清单共同维护身份和顺序，重复唯一与移除', async () => {
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0001' })
  await user.click(screen.getByRole('button', { name: '加入 demo-0001 到清单' }))
  await user.click(screen.getByRole('button', { name: '查看 demo-0002' }))
  const detail = screen.getByRole('dialog')
  await user.click(within(detail).getByRole('button', { name: '加入清单' }))
  expect(within(row('demo-0002')).getByRole('button', { name: 'demo-0002 已在清单' })).toBeDisabled()
  expect(within(detail).getByRole('button', { name: '已在清单' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await user.click(screen.getByRole('button', { name: /优先审查清单/ }))
  const rows = screen.getAllByRole('row').slice(1)
  expect(rows[0]).toHaveTextContent('demo-0001')
  expect(rows[1]).toHaveTextContent('demo-0002')
  await user.click(screen.getByRole('button', { name: '查看 demo-0001' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('demo-0001')
  await user.click(screen.getByRole('button', { name: '关闭详情' }))
  await user.click(screen.getByRole('button', { name: '移除 demo-0001' }))
  await user.click(screen.getByRole('button', { name: '移除 demo-0002' }))
  expect(screen.getByText('清单为空')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '返回列表选择提交' }))
  expect(screen.getByRole('button', { name: '加入 demo-0001 到清单' })).toBeEnabled()
  expect(within(row('demo-0001')).getByText('86%')).toBeVisible()
})

it('CRR-07/12 关闭详情保留查询并返回键盘触发位置', async () => {
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0010' })
  await user.type(screen.getByLabelText('提交标识搜索'), 'demo-0010')
  const trigger = screen.getByRole('button', { name: '查看 demo-0010' })
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('dialog')).toHaveTextContent('未提供')
  await user.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
  expect(screen.getByLabelText('提交标识搜索')).toHaveValue('demo-0010')
})

it('CRR-07 不存在标识显示返回入口而非另一条记录', () => {
  render(<CommitDetail data={parseDataset(demo)} id="missing" added={false} onAdd={() => {}} onClose={() => {}} />)
  expect(screen.getByRole('dialog')).toHaveTextContent('提交不存在')
  expect(screen.getByRole('button', { name: '返回列表' })).toBeVisible()
  expect(screen.queryByText('demo-0001')).not.toBeInTheDocument()
})

it('CRR-11 加载、空与失败区分，失败可重试', async () => {
  const user = userEvent.setup()
  let failed = true
  const failLoader = async () => { if (failed) throw new Error('读取失败'); return { ...demo, records: [] } }
  render(<App initialMode="demo" loader={failLoader} />)
  expect(screen.getByText('正在读取演示提交')).toBeVisible()
  await screen.findByText('数据不可用')
  failed = false
  await user.click(screen.getByRole('button', { name: '重新加载' }))
  await screen.findByText('暂无提交')
  expect(screen.queryByText('数据不可用')).not.toBeInTheDocument()
})

it('CRR-09 刷新相当的重新挂载恢复清单并同步列表', async () => {
  const user = userEvent.setup()
  const first = render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '加入 demo-0001 到清单' })
  await user.click(screen.getByRole('button', { name: '加入 demo-0001 到清单' }))
  first.unmount()
  render(<App initialMode="demo" loader={loader} />)
  expect(await screen.findByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
})

it('CRR-09 损坏清单提示恢复失败，仍可重新选择', async () => {
  window.localStorage.setItem(storageKey(parseDataset(demo)), '{')
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '加入 demo-0001 到清单' })
  expect(screen.getByRole('alert')).toHaveTextContent('恢复失败')
  await user.click(screen.getByRole('button', { name: '加入 demo-0001 到清单' }))
  expect(screen.getByRole('button', { name: 'demo-0001 已在清单' })).toBeDisabled()
})

it('CRR-10 保存被拒绝仍可加入和移除，并明确刷新风险', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('拒绝保存') })
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '加入 demo-0001 到清单' })
  await user.click(screen.getByRole('button', { name: '加入 demo-0001 到清单' }))
  expect(screen.getByRole('alert')).toHaveTextContent('本次清单未能保存，刷新后可能丢失')
  await user.click(screen.getByRole('button', { name: /优先审查清单/ }))
  await user.click(screen.getByRole('button', { name: '移除 demo-0001' }))
  expect(screen.getByText('清单为空')).toBeVisible()
})

it('CRR-10 无法恢复清单时仍可从详情加入', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('拒绝读取') })
  const user = userEvent.setup()
  render(<App initialMode="demo" loader={loader} />)
  await screen.findByRole('button', { name: '查看 demo-0001' })
  expect(screen.getByRole('alert')).toHaveTextContent('恢复失败')
  await user.click(screen.getByRole('button', { name: '查看 demo-0001' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '加入清单' }))
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: '已在清单' })).toBeDisabled()
})
