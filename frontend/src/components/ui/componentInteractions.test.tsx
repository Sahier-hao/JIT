import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/lib/test-utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'


function SortChoice() {
  const [value, setValue] = useState('risk')
  return <><ToggleGroup type="single" value={String(value)} onValueChange={nextValue => { if (nextValue) (setValue)(nextValue as typeof value); }} aria-label="排序">{([
    { value: 'risk', label: '按风险' }, { value: 'path', label: '按路径' },
  ]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup><output aria-label="当前排序">{value}</output></>
}

function AnalysisDialog() {
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState('main')
  return <><Button onClick={() => setOpen(true)}>打开分析表单</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>分析参数</DialogTitle></DialogHeader>
        <Input aria-label="分析分支" value={branch} onChange={event => setBranch(event.target.value)}/>
      </DialogContent>
    </Dialog>
  </>
}

describe('标准控件的键盘交互', () => {
  it('方向键移动后可以选择下一项，重复选择不会清空单选', async () => {
    const user = userEvent.setup()
    render(<SortChoice/>)
    await user.tab()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(screen.getByLabelText('当前排序')).toHaveTextContent('path')
    await user.click(screen.getByText('按路径'))
    expect(screen.getByLabelText('当前排序')).toHaveTextContent('path')
  })

  it('受控弹窗用 Esc 关闭后回到原按钮，重开保留表单草稿', async () => {
    const user = userEvent.setup()
    render(<AnalysisDialog/>)
    const trigger = screen.getByRole('button', { name: '打开分析表单' })
    await user.click(trigger)
    const branch = screen.getByRole('textbox', { name: '分析分支' })
    await user.clear(branch)
    await user.type(branch, 'release')
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getByRole('textbox', { name: '分析分支' })).toHaveValue('release')
  })
})
