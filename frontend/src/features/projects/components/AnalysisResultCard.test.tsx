import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisResultCard } from '@/features/projects/components/AnalysisResultCard'

afterEach(() => vi.restoreAllMocks())

const SYNC = '11111111-1111-4111-8111-111111111111'
const COLOR_FALLBACK = { high: '#9e4550', medium: '#8a6524', low: '#1f5d4c' }

function commit(id: string, risk: number, subject: string) {
  return {
    commitId: id.repeat(40).slice(0, 40), epoch: 1, risk, addedLines: 3, deletedLines: 1, files: 1,
    label: 0, labelNote: null, subject, features: {}, partition: 'scored',
  }
}

function page(commits: unknown[], total: number, offset = 0) {
  return new Response(JSON.stringify({ syncId: SYNC, status: 'completed', total, limit: 200, offset, commits }),
    { status: 200, headers: { 'Content-Type': 'application/json' } })
}

it('charts the score distribution, keeps the top commits and the source in one card', async () => {
  const commits = [commit('a', 0.55, '高分提交'), commit('b', 0.30, '次高提交'), commit('c', 0.12, '中档提交'), commit('d', 0.05, '低分提交')]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => page(commits, commits.length))
  render(<AnalysisResultCard syncId={SYNC} scope={null} activeView="all" distribution={{ high: 2, medium: 1, low: 1, unknown: 0 }}
    onOpenCommit={vi.fn()} onOpenAll={vi.fn()} onOpenDataset={vi.fn()}/>)

  const card = await screen.findByRole('region', { name: '当前分析结果' })
  expect(await screen.findByRole('img', { name: '模型分数分布柱状图' })).toBeVisible()
  expect(card).toHaveTextContent('每 0.05 一档')
  expect(card).toHaveTextContent('4 条已评分')
  expect(screen.getByRole('list', { name: '分档数量' })).toHaveTextContent('0.25 及以上 2 条')
  expect(screen.getByRole('list', { name: '分档数量' })).toHaveTextContent('0.10 – 0.25 1 条')
  expect(screen.getByRole('list', { name: '分档数量' })).toHaveTextContent('0.10 以下 1 条')
  const first = screen.getAllByRole('button', { name: /分/ })[0]
  expect(first).toHaveTextContent('高分提交')
  expect(card).toHaveTextContent('现成模型')
  expect(card).not.toHaveTextContent('ECharts')

  const user = userEvent.setup()
  const openDataset = vi.fn()
  render(<AnalysisResultCard syncId="22222222-2222-4222-8222-222222222222" scope={null} activeView="all" distribution={{ high: 1, medium: 0, low: 0, unknown: 0 }}
    onOpenCommit={vi.fn()} onOpenAll={vi.fn()} onOpenDataset={openDataset}/>)
  await user.click((await screen.findAllByRole('button', { name: '数据来源' })).at(-1)!)
  expect(openDataset).toHaveBeenCalled()
})

it('falls back to band counts when the analysis has more commits than the page can read', async () => {
  const commits = Array.from({ length: 200 }, (_, index) => commit('e', 0.2, `提交 ${index}`))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const offset = Number(new URL(String(input), 'http://localhost').searchParams.get('offset') ?? 0)
    return page(commits, 1200, offset)
  })
  render(<AnalysisResultCard syncId={SYNC} scope={null} activeView="all" distribution={{ high: 3, medium: 5, low: 4, unknown: 2 }}
    onOpenCommit={vi.fn()} onOpenAll={vi.fn()} onOpenDataset={vi.fn()}/>)

  expect(await screen.findByRole('img', { name: '模型分数分布柱状图' })).toBeVisible()
  expect(screen.getByRole('region', { name: '当前分析结果' })).toHaveTextContent('按分档统计')
  expect(screen.getByRole('list', { name: '分档数量' })).toHaveTextContent('未评分 2 条')
  await waitFor(() => expect(screen.getByRole('list', { name: '分档数量' })).toBeVisible())
})

it('keeps the chart colours distinct for the three bands', async () => {
  const { histogramOption } = await import('@/features/projects/analysisScore')
  const option = histogramOption([commit('a', 0.02, 'a'), commit('b', 0.12, 'b'), commit('c', 0.5, 'c')] as never, {
    series: '#111111', seriesInk: '#222222', grid: '#333333', axis: '#444444', text: '#555555', textStrong: '#666666',
    surface: '#ffffff', border: '#777777', categorical: [COLOR_FALLBACK.low, COLOR_FALLBACK.medium, '#5e7a39', COLOR_FALLBACK.high], other: '#888888',
  })
  const series = (option.series as { data: { itemStyle: { color: string } }[] }[])[0]
  const colours = new Set(series.data.map(row => row.itemStyle.color))
  expect(colours.size).toBe(3)
})
