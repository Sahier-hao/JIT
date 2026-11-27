import { render, screen, waitFor } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DatasetRowsTable } from '@/features/datasets/mydata/DatasetRowsTable'

afterEach(() => vi.restoreAllMocks())

const VERSION = 'demo-2026-01-01_2026-01-31'

function page(offset: number) {
  const rows = Array.from({ length: offset === 0 ? 50 : 2 }, (_, index) => [
    String(offset + index + 1), '2026-01-02', '7', String(index % 2),
  ])
  return Response.json({
    version: VERSION, columns: ['commit_id', 'author_date', 'la', 'bugcount'],
    rows, total: 52, offset, limit: 50,
  })
}

it('reads the dataset rows and pages through them', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const offset = Number(new URL(String(input), 'http://localhost').searchParams.get('offset') ?? 0)
    return page(offset)
  })
  render(<DatasetRowsTable version={VERSION}/>)

  expect(await screen.findByText('52 行 · 4 列')).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'commit_id' })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'bugcount' })).toBeVisible()
  expect(screen.getByText('第 1 / 2 页')).toBeVisible()
  expect(screen.getAllByRole('row')).toHaveLength(51)

  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  await waitFor(() => expect(screen.getByText('第 2 / 2 页')).toBeVisible())
  expect(screen.getAllByRole('row')).toHaveLength(3)
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  expect(fetch.mock.calls.some(([input]) => String(input).includes('offset=50'))).toBe(true)
})
