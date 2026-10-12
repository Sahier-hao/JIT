import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useDataset } from './useDataset'

const good = { project: '演示项目', version: 'demo-v1', records: [{ id: 'demo-a', time: '2026-10-01T00:00:00Z' }] }

it('CRR-11 等待数据时加载，完成后提供验证后的提交', async () => {
  let resolve!: (value: unknown) => void
  const pending = new Promise<unknown>(done => { resolve = done })
  const loader = () => pending
  const { result } = renderHook(() => useDataset(loader))
  expect(result.current.resource.state).toBe('loading')
  await act(async () => resolve(good))
  expect(result.current.resource).toMatchObject({ state: 'ready', data: { records: [{ id: 'demo-a' }] } })
})

it('CRR-11 空集合成功，不误报错误', async () => {
  const loader = async () => ({ ...good, records: [] })
  const { result } = renderHook(() => useDataset(loader))
  await waitFor(() => expect(result.current.resource).toMatchObject({ state: 'ready', data: { records: [] } }))
})

it('CRR-11 异常后重试成功，清除旧错误', async () => {
  let failed = true
  const loader = async () => { if (failed) throw new Error('读取被拒绝'); return good }
  const { result } = renderHook(() => useDataset(loader))
  await waitFor(() => expect(result.current.resource).toMatchObject({ state: 'error', error: '读取被拒绝' }))
  failed = false
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.resource.state).toBe('ready'))
  expect(result.current.resource).not.toHaveProperty('error')
})

it('CRR-01/11 必需来源缺失进入不可用状态', async () => {
  const loader = async () => ({ ...good, project: '' })
  const { result } = renderHook(() => useDataset(loader))
  await waitFor(() => expect(result.current.resource).toMatchObject({ state: 'error', error: expect.stringContaining('来源') }))
})
