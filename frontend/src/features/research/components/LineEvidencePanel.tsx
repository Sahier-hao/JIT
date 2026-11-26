import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { LineEvidenceRow, LineReviewEvidence } from '@/features/research/lineEvidence'

function signed(value: number, digits = 3): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}`
}

function statusText(status: LineReviewEvidence['status']): string {
  return {
    'unsupported-language': '当前文件语言不在研究模型覆盖范围',
    'generated-or-skipped-path': '该路径属于生成产物、测试或模型未覆盖的源码范围',
    deleted: '删除文件没有目标侧代码行',
    'patch-incomplete': '固定 patch 不完整，不能确认真实新增行',
    'no-candidates': '固定 patch 没有可分析的新增或修改代码行',
    'content-unavailable': '固定源码不可读取、不完整或超过限制',
    'source-unavailable': '固定提交来源暂不可读取',
    'model-unavailable': '行级研究模型产物不可用',
    supported: '可用',
  }[status]
}

function summary(row: LineEvidenceRow, intercept: number): string {
  const top = row.contributions.slice(0, 3)
  const features = top.length
    ? `前 3 项行级特征为${top.map(item => item.label).join('、')}`
    : '该行没有非零行级特征贡献'
  return `第 ${row.line} 行排序分数为 ${row.score.toFixed(4)}（概率，单独展示）；${features}。截距 ${signed(intercept, 3)} 与语言项 ${signed(row.languageContribution)} 只用于核对 log-odds 分解。行级特征贡献不是缺陷原因。`
}

function ContributionBars({ row }: { row: LineEvidenceRow }) {
  if (!row.contributions.length) return <p className="text-xs text-foreground-3">该行没有非零特征贡献，不渲染空条形图。</p>
  const maximum = Math.max(...row.contributions.map(item => Math.abs(item.contribution)), 0)
  return <ol className="grid gap-2" aria-label={`第 ${row.line} 行前 3 个 log-odds 特征贡献`}>
    {row.contributions.map(item => {
      const width = maximum ? Math.max(3, Math.round(Math.abs(item.contribution) / maximum * 100)) : 0
      return <li key={item.feature} className="grid grid-cols-[120px_minmax(0,1fr)_100px] items-center gap-2 text-xs">
        <span className="truncate text-foreground-2" title={item.feature}>{item.label}</span>
        <span className="h-3 overflow-hidden rounded-sm bg-strong" aria-hidden="true">
          <i className={cn('block h-full', item.contribution > 0 ? 'bg-rose' : 'bg-teal')} style={{ width: `${width}%` }}/>
        </span>
        <span className="text-right font-mono tabular-nums text-foreground">{signed(item.contribution)}</span>
      </li>
    })}
  </ol>
}

function ContributionTable({ row }: { row: LineEvidenceRow }) {
  return <div className="overflow-x-auto rounded-md border border-border-soft">
    <Table>
      <TableHeader><TableRow>
        <TableHead scope="col">特征</TableHead><TableHead scope="col">行内值</TableHead>
        <TableHead scope="col">系数</TableHead><TableHead scope="col">带符号贡献（log-odds）</TableHead>
        <TableHead scope="col">方向</TableHead>
      </TableRow></TableHeader>
      <TableBody>{row.contributions.length ? row.contributions.map(item => <TableRow key={item.feature}>
        <TableHead scope="row">{item.label} <code className="font-mono text-[10px] text-foreground-4">{item.feature}</code></TableHead>
        <TableCell>{item.value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
        <TableCell>{signed(item.weight)}</TableCell>
        <TableCell><b>{signed(item.contribution)}</b></TableCell>
        <TableCell>{item.direction === 'increases' ? '推高分数' : '拉低分数'}</TableCell>
      </TableRow>) : <TableRow><TableCell colSpan={5}>无非零特征贡献</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

export function LineEvidencePanel({ result }: { result: LineReviewEvidence }) {
  const [selectedLine, setSelectedLine] = useState(result.lines[0]?.line ?? null)
  if (result.status !== 'supported') {
    return <div className="grid gap-2 rounded-lg border border-border-soft bg-sunken p-3" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-deep">
        <AlertTriangle aria-hidden="true" size={16}/>行级研究证据不可用
      </p>
      <p className="text-xs leading-5 text-foreground-3">{statusText(result.status)}{result.reason ? `（${result.reason}）` : ''}。</p>
    </div>
  }
  const selected = result.lines.find(row => row.line === selectedLine) ?? result.lines[0]
  return <section className="grid gap-3" aria-label="行级研究证据">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h4 className="text-sm font-semibold">行级研究证据</h4>
        <p className="mt-1 text-xs leading-5 text-foreground-3">
          {result.language} · {result.coverage.eligibleLines} 个新增/修改候选行 · patch {result.coverage.patchComplete ? '完整' : '不完整'}。研究预览，未校准，不参与提交风险。
        </p>
        <p className="mt-1 text-[11px] leading-4 text-foreground-4">提交级解释、行分数概率与 log-odds 贡献相互独立：不求和、不统一排名，也不自动选择“最佳解释”。</p>
      </div>
      <span className="rounded-sm bg-sunken px-2 py-1 font-mono text-[10px] text-foreground-3">{result.explanationMethod}</span>
    </div>
    <div className="grid gap-3 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
      <div className="grid content-start gap-2" aria-label="候选行排序">
        {result.lines.map(row => <button key={row.line} type="button" onClick={() => setSelectedLine(row.line)}
          aria-pressed={selected.line === row.line}
          className={cn('grid w-full grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-2 rounded-md border px-2 py-2 text-left text-xs',
            selected.line === row.line ? 'border-accent/40 bg-accent-soft' : 'border-border-soft bg-card hover:bg-sunken')}>
          <span className="font-mono text-foreground-4">{row.rank}</span>
          <span className="min-w-0"><span className="block truncate font-mono text-foreground-2">L{row.line} · {row.text || ' '}</span>
            <span className="mt-0.5 block text-[10px] text-foreground-4">{row.contributions.slice(0, 3).map(item => item.label).join(' / ') || '无贡献'}</span></span>
          <span className="flex items-center justify-end gap-1 font-mono tabular-nums text-foreground">{row.score.toFixed(3)}<ChevronRight aria-hidden="true" size={12}/></span>
        </button>)}
      </div>
      <div className="grid min-w-0 content-start gap-3 rounded-md border border-border-soft bg-sunken/60 p-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm">第 {selected.line} 行</strong>
            <span className="font-mono text-[11px] text-foreground-3">分数（概率） {selected.score.toFixed(4)}</span>
          </div>
          <code className="block overflow-x-auto whitespace-pre rounded-sm bg-card px-2 py-1.5 font-mono text-xs text-foreground-2">{selected.text || ' '}</code>
        </div>
        <p className="text-xs leading-5 text-foreground-2">{summary(selected, result.intercept ?? 0)}</p>
        <ContributionBars row={selected}/>
        <ContributionTable row={selected}/>
        <dl className="grid gap-1 text-[11px] text-foreground-3 sm:grid-cols-3">
          <div><dt className="inline">概率分数：</dt><dd className="inline font-mono text-foreground">{selected.score.toFixed(6)}</dd></div>
          <div><dt className="inline">raw logit：</dt><dd className="inline font-mono text-foreground">{signed(selected.logit, 6)}</dd></div>
          <div><dt className="inline">特征贡献合计：</dt><dd className="inline font-mono text-foreground">{signed(selected.contributionTotal, 6)}</dd></div>
          <div><dt className="inline">截距：</dt><dd className="inline font-mono text-foreground">{signed(result.intercept ?? 0, 6)}</dd></div>
          <div><dt className="inline">语言项：</dt><dd className="inline font-mono text-foreground">{signed(selected.languageContribution, 6)}</dd></div>
          <div><dt className="inline">其他贡献：</dt><dd className="inline font-mono text-foreground">{signed(selected.otherContribution, 6)}</dd></div>
        </dl>
        <p className="text-xs leading-5 text-amber-deep">{result.contributionCaveat}</p>
      </div>
    </div>
  </section>
}
