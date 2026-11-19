import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { CommitRisk } from '@/features/projects/useSnapshotAnalyses'

/** 按风险或提交顺序排列 PR 提交；点击一行进入该提交涉及的文件。 */
export function ReviewCommitTable({ commits, commitRisks, order, onOrder, onSelect, commitsComplete, totalCommits }: {
  commits: { sha: string; message: string }[]
  commitRisks: Record<string, CommitRisk>
  order: 'risk' | 'order'
  onOrder: (value: 'risk' | 'order') => void
  onSelect: (sha: string) => void
  commitsComplete: boolean
  totalCommits: number
}) {
  const scoredCommits = commits.filter(commit => commitRisks[commit.sha] != null).length
  const rows = order === 'order' ? commits : [...commits].sort((a, b) => {
    const left = commitRisks[a.sha]?.risk, right = commitRisks[b.sha]?.risk
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    return right - left
  })
  return <section className="grid gap-2" aria-label="PR 提交风险排序">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-foreground">提交风险排序</h2>
      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
        <span>{scoredCommits}/{commits.length} 有分数</span>
        <ToggleGroup type="single" value={String(order)} onValueChange={nextValue => { if (nextValue) onOrder(nextValue as 'risk' | 'order') }} aria-label="提交排序">{([{ label: '按风险', value: 'risk' }, { label: '按提交顺序', value: 'order' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
      </div>
    </div>
    <Table><TableHeader><TableRow><TableHead>提交 / 改动</TableHead><TableHead>模型分数</TableHead><TableHead className="text-right tabular-nums">变更行</TableHead><TableHead className="text-right tabular-nums">文件</TableHead></TableRow></TableHeader><TableBody>{rows.map(commit => {
      const info = commitRisks[commit.sha]
      const lines = info ? (info.addedLines ?? 0) + (info.deletedLines ?? 0) : null
      return <TableRow key={commit.sha} tabIndex={0} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => onSelect(commit.sha)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(commit.sha) } }}><TableCell><div className="flex min-w-0 flex-wrap items-baseline gap-2"><span className="truncate text-sm font-medium text-foreground">{commit.message.split('\n')[0]}</span><code className="font-mono text-xs text-foreground-3">{commit.sha.slice(0, 12)}</code></div></TableCell><TableCell><span className={cn('tabular-nums', info ? 'text-foreground' : 'text-foreground-4')}>{info ? info.risk.toFixed(2) : '未评分'}</span></TableCell><TableCell className="text-right tabular-nums">{lines == null ? '—' : lines.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{info?.fileCount ?? '—'}</TableCell></TableRow>
    })}</TableBody></Table>
    {!commitsComplete ? <p className="text-xs text-foreground-3">仅显示已加载的 {commits.length}/{totalCommits} 条提交。</p> : null}
  </section>
}
