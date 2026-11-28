import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { LineEvidenceContribution, LineEvidenceRow, LineReviewEvidence } from '@/features/research/lineEvidence'

function signed(value: number, digits = 3): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}`
}

function statusText(status: LineReviewEvidence['status'], reason: string | null): string {
  if (reason === 'LINE_PREVIEW_CONTEXT_REQUIRED') {
    return '当前行级研究模型需要完整文件上下文；该版本不会猜测缺失的上下文'
  }
  if (reason === 'patch-candidate-limit') {
    return '本次改动行超过研究预览上限，未生成排序'
  }
  return {
    'unsupported-language': '当前文件语言不在研究模型覆盖范围，只覆盖 JavaScript / TypeScript',
    'generated-or-skipped-path': '该路径属于生成产物、测试或模型未覆盖的源码范围',
    deleted: '删除文件没有目标侧代码行',
    'patch-incomplete': '固定 patch 不完整，不能确认真实新增行',
    'no-candidates': '固定 patch 没有可分析的新增或修改代码行',
    'content-unavailable': '行级特征无法计算，已保留原因，不补造分数',
    'source-unavailable': '固定提交或 PR 来源暂不可读取',
    'model-unavailable': '行级研究模型产物不可用，请核验研究产物',
    supported: '可用',
  }[status] ?? '行级研究证据不可用'
}

function languageLabel(language: LineReviewEvidence['language']): string {
  return language === 'typescript' ? 'TypeScript' : language === 'javascript' ? 'JavaScript' : '未知语言'
}

/** 把模型特征翻成审查者能核对的行内事实，不把它们说成缺陷原因。 */
function featurePhrase(item: LineEvidenceContribution): string {
  const value = item.value
  switch (item.feature) {
    case 'lineLength': return value >= 120 ? '这一行很长' : value >= 80 ? '这一行偏长' : '这一行较短'
    case 'indent': return `缩进 ${Math.round(value)} 格`
    case 'blank': return value ? '空行' : '非空行'
    case 'comment': return value ? '注释行' : '代码行'
    case 'fileLines': return `文件共 ${Math.round(value)} 行`
    case 'lineRatio': return '位于文件靠后位置'
    case 'if': return value ? `含 ${Math.round(value)} 处 if` : '没有 if'
    case 'for': return value ? `含 ${Math.round(value)} 处 for` : '没有 for'
    case 'while': return value ? `含 ${Math.round(value)} 处 while` : '没有 while'
    case 'return': return value ? '含 return' : '没有 return'
    case 'try': return value ? '含 try 块' : '没有 try 块'
    case 'catch': return value ? '含 catch 块' : '没有 catch 块'
    case 'assign': return `含 ${Math.round(value)} 处赋值`
    case 'compare': return `含 ${Math.round(value)} 处比较`
    case 'call': return `含 ${Math.round(value)} 个调用括号`
    case 'member': return `含 ${Math.round(value)} 处成员访问`
    case 'index': return `含 ${Math.round(value)} 处索引访问`
    case 'identifier': return `含 ${Math.round(value)} 个标识符`
    case 'digit': return `含 ${Math.round(value)} 个数字字符`
    default: return item.label
  }
}

function lineContributions(row: LineEvidenceRow): LineEvidenceContribution[] {
  return row.contributions.filter(item => !item.feature.startsWith('language:'))
}

function plainSummary(row: LineEvidenceRow, total: number): string {
  const relevant = lineContributions(row)
  const rising = relevant.filter(item => item.contribution > 0).slice(0, 2).map(featurePhrase)
  const falling = relevant.filter(item => item.contribution < 0).slice(0, 1).map(featurePhrase)
  if (!rising.length && !falling.length) {
    return `这一行在 ${total} 个改动行中排第 ${row.rank} 位；没有非零的行内特征，排序主要来自截距与全文件相同的语言项。`
  }
  const head = `这一行在 ${total} 个改动行中排第 ${row.rank} 位。`
  const reasons = [
    rising.length ? `${rising.join('、')}推高排名` : '',
    falling.length ? `${falling.join('、')}拉低排名` : '',
  ].filter(Boolean).join('；')
  return `${head}${reasons}。这些只是模型看到的行内特征，不是缺陷原因。`
}

function ContributionBars({ row }: { row: LineEvidenceRow }) {
  const items = lineContributions(row)
  if (!items.length) return <p className="text-xs text-foreground-3">该行没有非零的行内特征，不渲染空条形图。</p>
  const maximum = Math.max(...items.map(item => Math.abs(item.contribution)), 0)
  return <ol className="grid gap-2" aria-label={`第 ${row.line} 行前 3 个 log-odds 行级特征贡献`}>
    {items.map(item => {
      const width = maximum ? Math.max(3, Math.round(Math.abs(item.contribution) / maximum * 100)) : 0
      return <li key={item.feature} className="grid grid-cols-[minmax(84px,110px)_minmax(0,1fr)_64px] items-center gap-2 text-xs">
        <span className="truncate text-foreground-2" title={featurePhrase(item)}>{featurePhrase(item)}</span>
        <span className="h-1.5 overflow-hidden rounded-sm bg-strong" aria-hidden="true">
          <i className={cn('block h-full', item.contribution > 0 ? 'bg-rose' : 'bg-teal')} style={{ width: `${width}%` }}/>
        </span>
        <span className="text-right font-mono tabular-nums text-foreground-3">{signed(item.contribution)}</span>
      </li>
    })}
  </ol>
}

function ContributionTable({ row }: { row: LineEvidenceRow }) {
  return <div className="overflow-x-auto rounded-md border border-border-soft">
    <Table>
      <TableHeader><TableRow>
        <TableHead scope="col">行内特征</TableHead><TableHead scope="col">本次值</TableHead>
        <TableHead scope="col">系数</TableHead><TableHead scope="col">贡献（log-odds）</TableHead>
        <TableHead scope="col">方向</TableHead>
      </TableRow></TableHeader>
      <TableBody>{row.contributions.length ? row.contributions.map(item => <TableRow key={item.feature}>
        <TableHead scope="row">{item.label} <code className="font-mono text-[10px] text-foreground-4">{item.feature}</code></TableHead>
        <TableCell>{item.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</TableCell>
        <TableCell>{signed(item.weight)}</TableCell>
        <TableCell><b>{signed(item.contribution)}</b></TableCell>
        <TableCell>{item.direction === 'increases' ? '推高研究分' : '拉低研究分'}</TableCell>
      </TableRow>) : <TableRow><TableCell colSpan={5}>无非零特征贡献</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

export function LineEvidencePanel({ result, onLocate }: {
  result: LineReviewEvidence
  onLocate?: (line: number) => void
}) {
  const [selectedLine, setSelectedLine] = useState(result.lines[0]?.line ?? null)
  if (result.status !== 'supported') {
    return <div className="grid gap-2 rounded-lg border border-border-soft bg-card p-3" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-deep">
        <AlertTriangle aria-hidden="true" size={16}/>行级研究排序不可用
      </p>
      <p className="text-xs leading-5 text-foreground-3">{statusText(result.status, result.reason)}。</p>
      {result.reason && result.reason !== result.status ? <p className="font-mono text-[10px] text-foreground-4">原因代码：{result.reason}</p> : null}
      <p className="text-[11px] leading-4 text-foreground-4">行级排序是独立研究证据，不会用其他文件、提交分数或空行补齐。</p>
    </div>
  }
  const selected = result.lines.find(row => row.line === selectedLine) ?? result.lines[0]
  const total = result.lines.length
  return <section className="grid gap-4" aria-label="行级研究排序">
    <header className="grid gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">行级研究排序</h4>
        <span className="rounded-sm bg-sunken px-2 py-0.5 text-[10px] text-foreground-3">研究预览 · 未校准</span>
      </div>
      <p className="text-xs leading-5 text-foreground-3">
        {languageLabel(result.language)} · {result.coverage.eligibleLines} 个新增或修改行参与排序 · 文本来自固定 patch
      </p>
      <p className="text-[11px] leading-4 text-foreground-4">
        模型只看行文本形态，0–1 研究分只用于决定先看哪一行；不是缺陷概率，也不改变提交风险。
      </p>
    </header>

    <ol className="grid gap-1" aria-label="候选行排序">
      {result.lines.map(row => <li key={row.line}>
        <button type="button" onClick={() => setSelectedLine(row.line)}
          aria-pressed={selected.line === row.line}
          className={cn('grid w-full grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
            selected.line === row.line ? 'border-accent/40 bg-accent-soft' : 'border-transparent hover:border-border-soft hover:bg-sunken')}>
          <span className="font-mono text-[11px] text-foreground-4">{row.rank}</span>
          <span className="min-w-0">
            <span className="flex items-baseline gap-2">
              <code className="shrink-0 font-mono text-[11px] text-foreground-3">L{row.line}</code>
              <span className="truncate font-mono text-foreground-2">{row.text || ' '}</span>
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-foreground-4">
              {lineContributions(row).slice(0, 2).map(featurePhrase).join(' · ') || '无显著行内特征'}
            </span>
          </span>
          <span className="font-mono text-sm tabular-nums text-foreground">{row.score.toFixed(2)}</span>
        </button>
      </li>)}
    </ol>

    <article className="grid gap-3 rounded-md border border-border-soft bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <strong className="text-sm text-foreground">第 {selected.line} 行</strong>
          <span className="ml-2 text-xs text-foreground-3">第 {selected.rank} / {total} 位</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums text-foreground">{selected.score.toFixed(2)}</span>
          {onLocate ? <button type="button" className="text-xs text-accent underline-offset-2 hover:underline"
            onClick={() => onLocate(selected.line)}>在代码中定位</button> : null}
        </div>
      </div>
      <code className="block overflow-x-auto whitespace-pre rounded-sm bg-sunken px-2.5 py-2 font-mono text-xs text-foreground-2">{selected.text || ' '}</code>
      <p className="text-xs leading-5 text-foreground-2">{plainSummary(selected, total)}</p>
      <ContributionBars row={selected}/>
      <details className="rounded-sm border border-border-soft">
        <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-foreground-2">技术口径与完整贡献</summary>
        <div className="grid gap-2 border-t border-border-soft p-2.5">
          <ContributionTable row={selected}/>
          <dl className="grid gap-1 text-[11px] text-foreground-3 sm:grid-cols-2">
            <div><dt className="inline">研究分：</dt><dd className="inline font-mono text-foreground-2">{selected.score.toFixed(4)}</dd></div>
            <div><dt className="inline">raw logit：</dt><dd className="inline font-mono text-foreground-2">{signed(selected.logit, 4)}</dd></div>
            <div><dt className="inline">特征贡献合计：</dt><dd className="inline font-mono text-foreground-2">{signed(selected.contributionTotal, 4)}</dd></div>
            <div><dt className="inline">截距：</dt><dd className="inline font-mono text-foreground-2">{signed(result.intercept ?? 0, 4)}</dd></div>
            <div><dt className="inline">语言项：</dt><dd className="inline font-mono text-foreground-2">{signed(selected.languageContribution, 4)}</dd></div>
            <div><dt className="inline">其他贡献：</dt><dd className="inline font-mono text-foreground-2">{signed(selected.otherContribution, 4)}</dd></div>
          </dl>
          <p className="text-[11px] leading-4 text-foreground-4">特征贡献合计 + 截距 = raw logit；表格只列前 3 个非零特征，其余计入“其他贡献”。语言项对同一文件的所有行相同，不参与行间比较。</p>
        </div>
      </details>
      <details className="rounded-sm border border-border-soft">
        <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-foreground-2">模型限制与来源（{result.caveats.length + 1}）</summary>
        <ul className="grid gap-1 border-t border-border-soft p-2.5 text-[11px] leading-4 text-foreground-4">
          <li>{result.contributionCaveat}</li>
          {result.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}
        </ul>
      </details>
    </article>
  </section>
}
