import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { describe, expect, it } from 'vitest'
import { render, screen } from '../../test-utils'


describe('共享表面', () => {
  it('表格使用密度间距与统一表头', () => {
    const { container } = render(<Table><TableHeader><TableRow><TableHead>提交</TableHead><TableHead className="text-right tabular-nums">风险</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>abc</TableCell><TableCell className="text-right tabular-nums">0.42</TableCell></TableRow></TableBody></Table>)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[0].className).toContain('px-cell-x')
    expect(headers[1].className).toContain('text-right')
    expect(container.querySelector('tbody tr')?.className).toContain('h-row')
  })

  it('卡片与标题使用密度内边距', () => {
    const { container } = render(<Card><CardHeader><CardTitle>{"模型"}</CardTitle><CardDescription>{"说明"}</CardDescription></CardHeader><CardContent>内容</CardContent></Card>)
    expect(container.firstElementChild?.className).toContain('p-card')
    expect(screen.getByRole('heading', { name: '模型' }).className).toContain('text-base')
  })

  it('页面标题只有一层主标题', () => {
    render(<header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3"><div><p className="text-xs text-muted-foreground">{"项目"}</p><h1 className="text-xl font-semibold">{"项目详情"}</h1></div><div className="flex flex-wrap gap-2">{<button type="button">操作</button>}</div></header>)
    expect(screen.getByRole('heading', { level: 1, name: '项目详情' })).toBeVisible()
    expect(screen.getByRole('button', { name: '操作' })).toBeVisible()
  })

  it('进度条暴露可访问数值', () => {
    render(<Progress value={40} max={80} aria-label="训练进度"/>)
    const bar = screen.getByRole('progressbar', { name: '训练进度' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar.firstElementChild).toHaveStyle({ transform: 'translateX(-50%)' })
  })
})
