import { render, screen } from '@/lib/test-utils'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { DatePicker } from '@/components/ui/date-picker'

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

it('selects a day from the calendar', async () => {
  const onChange = vi.fn()
  const today = new Date()
  render(<DatePicker value="" onChange={onChange} ariaLabel="起始日期"/>)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('起始日期'))
  expect(await screen.findByRole('button', { name: '上个月' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: /15日/ }))
  expect(onChange).toHaveBeenCalledWith(iso(today.getFullYear(), today.getMonth() + 1, 15))
})

it('applies a typed date and can clear the value', async () => {
  const onChange = vi.fn()
  render(<DatePicker value="2024-05-06" onChange={onChange} ariaLabel="结束日期"/>)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('结束日期'))
  await user.clear(screen.getByLabelText('结束日期手动输入'))
  await user.type(screen.getByLabelText('结束日期手动输入'), '2025-01-01')
  await user.click(screen.getByRole('button', { name: '应用日期' }))
  expect(onChange).toHaveBeenCalledWith('2025-01-01')

  await user.click(screen.getByLabelText('结束日期'))
  await user.click(screen.getByRole('button', { name: '清除' }))
  expect(onChange).toHaveBeenLastCalledWith('')
})
