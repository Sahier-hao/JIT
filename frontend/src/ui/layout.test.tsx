/**
 * 共享表面的契约：密度间距、表头语义、页面标题层级与进度条可访问数值。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '../test-utils'
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from './layout'

describe('共享表面', () => {
  it('表格使用密度间距与统一表头', () => {
    const { container } = render(<Table>
      <TableHead><TableRow><TableHeaderCell>提交</TableHeaderCell><TableHeaderCell numeric>风险</TableHeaderCell></TableRow></TableHead>
      <TableBody><TableRow><TableCell>abc</TableCell><TableCell numeric>0.42</TableCell></TableRow></TableBody>
    </Table>)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0].className).toContain('px-cell-x')
    expect(headers[1].className).toContain('text-right')
    expect(container.querySelector('tbody tr')?.className).toContain('h-row')
  })

  it('卡片与标题使用密度内边距', () => {
    const { container } = render(<Card><CardHeader title="模型" description="说明"/><CardBody>内容</CardBody></Card>)
    expect(container.firstElementChild?.className).toContain('p-card')
    expect(screen.getByRole('heading', { name: '模型' }).className).toContain('text-base')
  })

  it('页面标题只有一层主标题', () => {
    render(<PageHeader eyebrow="项目" title="项目详情" actions={<button type="button">操作</button>}/>)
    expect(screen.getByRole('heading', { level: 1, name: '项目详情' })).toBeVisible()
    expect(screen.getByRole('button', { name: '操作' })).toBeVisible()
  })

  it('进度条暴露可访问数值', () => {
    render(<Progress value={40} max={80} label="训练进度"/>)
    const bar = screen.getByRole('progressbar', { name: '训练进度' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar.firstElementChild).toHaveStyle({ width: '50%' })
  })
})
