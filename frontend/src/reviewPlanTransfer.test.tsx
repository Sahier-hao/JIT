import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PlanTransfer } from './components/PlanTransfer'
import { makePlan, parsePlan, validatePlan, type PlanSource } from './reviewPlanTransfer'

const source: PlanSource = { repositoryId: '11111111-1111-4111-8111-111111111111', viewSyncId: '22222222-2222-4222-8222-222222222222', datasetVersion: 'data-v1', modelId: null, runId: null }
const plan = { format: 'jit-review-plan-v1' as const, source, commitIds: ['b', 'a'] }
afterEach(() => vi.restoreAllMocks())

it('validates full fixed context and preserves selected order without exporting scores', async () => {
  expect(makePlan(source, ['b','a'])).toEqual(plan)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(plan)))
  expect(await validatePlan(plan)).toEqual(plan)
  expect(String(fetch.mock.calls[0][0])).toContain(`viewSyncId=${source.viewSyncId}`)
  expect(fetch.mock.calls[0][1]?.method).toBe('POST')
  expect(parsePlan(JSON.stringify(plan), source)).toEqual(plan)
  expect(() => parsePlan(JSON.stringify({ ...plan, source: { ...source, runId: 'different' } }), source)).toThrow(/来源/)
  expect(() => parsePlan(JSON.stringify({ ...plan, commitIds: ['a','a'] }), source)).toThrow()
})

it('previews a checked backup and only merges after explicit confirmation', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(plan)))
  const merge = vi.fn(() => '')
  render(<PlanTransfer source={source} ids={['existing','b']} onMerge={merge}/> )
  const user = userEvent.setup()
  await user.click(screen.getByText('计划备份与恢复'))
  await user.upload(screen.getByLabelText('选择计划备份'), new File([JSON.stringify(plan)], 'plan.json', { type: 'application/json' }))
  expect(await screen.findByText(/备份有 2 条，已有 1 条，将新增 1 条/)).toBeVisible()
  expect(merge).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '合并到当前计划' }))
  expect(merge).toHaveBeenCalledWith(['b','a'])
  expect(await screen.findByText(/已合并/)).toBeVisible()
})

it('keeps the old plan on invalid files, network failure and rejected local writes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  const merge = vi.fn(() => '浏览器拒绝写入，原计划保持不变')
  render(<PlanTransfer source={source} ids={['existing']} onMerge={merge}/> )
  const user = userEvent.setup(), input = screen.getByLabelText('选择计划备份')
  await user.click(screen.getByText('计划备份与恢复'))
  await user.upload(input, new File(['{'], 'broken.json', { type: 'application/json' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(fetch).not.toHaveBeenCalled(); expect(merge).not.toHaveBeenCalled()
  await user.upload(input, new File([JSON.stringify(plan)], 'offline.json', { type: 'application/json' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(merge).not.toHaveBeenCalled()
  fetch.mockImplementation(async () => new Response(JSON.stringify(plan)))
  await user.upload(input, new File([JSON.stringify(plan)], 'retry.json', { type: 'application/json' }))
  await user.click(await screen.findByRole('button', { name: '合并到当前计划' }))
  expect(await screen.findByText('浏览器拒绝写入，原计划保持不变')).toBeVisible()
  expect(screen.queryByText(/已合并/)).not.toBeInTheDocument()
})

it('does not accept an old validation result after changing analysis', async () => {
  let resolve!: (value: Response) => void
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>(done => { resolve = done }))
  const merge = vi.fn(() => '')
  const view = render(<PlanTransfer source={source} ids={[]} onMerge={merge}/> )
  await userEvent.click(screen.getByText('计划备份与恢复'))
  await userEvent.upload(screen.getByLabelText('选择计划备份'), new File([JSON.stringify(plan)], 'plan.json', { type: 'application/json' }))
  view.rerender(<PlanTransfer source={{ ...source, viewSyncId: source.repositoryId }} ids={[]} onMerge={merge}/> )
  resolve(new Response(JSON.stringify(plan)))
  await waitFor(() => expect(screen.queryByRole('button', { name: '合并到当前计划' })).not.toBeInTheDocument())
  expect(merge).not.toHaveBeenCalled()
})
