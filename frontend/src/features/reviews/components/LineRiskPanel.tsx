import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle, LocateFixed, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPRContext, type PRFile, type PRSnapshot } from '@/features/reviews/prReviewClient'
import { useReviewAccount } from '@/features/reviews/reviewAccount'
import { addedHeadLines, lineRiskLanguage, rankChangedLineScores } from '@/features/reviews/lineRisk'
import { lineFeatureLabel, scoreLineResearch } from '@/features/research/lineResearch'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '暂时无法读取'

function signed(value: number): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(3)}`
}

/**
 * PR 文件级研究排序：只对当前文件真实新增/修改的 JS/TS 行排序。
 * 分数不是缺陷概率，不写草稿、不改提交分数、不阻断合并。
 */
export function LineRiskPanel({ source, file, onLocate }: {
  source: PRSnapshot
  file: PRFile
  onLocate: (line: number) => void
}) {
  const account = useReviewAccount()
  const language = lineRiskLanguage(file.path)
  const changed = useMemo(() => new Set(addedHeadLines(file.patch)), [file.patch])
  const head = useQuery({
    queryKey: ['pr-code', account.account, account.generation, source.snapshotId, file.path, 'head'],
    queryFn: ({ signal }) => getPRContext(source, file.path, 'head', signal),
    enabled: Boolean(language && changed.size),
    retry: false,
  })
  const scored = useQuery({
    queryKey: ['pr-line-risk', account.account, account.generation, source.snapshotId, file.path, head.data?.ref],
    queryFn: ({ signal }) => scoreLineResearch(head.data!.content, language!, signal),
    enabled: Boolean(head.data && language),
    retry: false,
  })
  const rows = useMemo(
    () => scored.data ? rankChangedLineScores(scored.data.lines, changed) : [],
    [scored.data, changed],
  )

  if (!language) {
    return <div className="grid gap-2 p-4 text-xs text-foreground-3">
      <p className="font-medium text-foreground-2">行级排序（研究）</p>
      <p>当前文件不是 JavaScript/TypeScript，行级研究模型不覆盖此语言。</p>
      <p>不使用其他模型或提交级分数替代。</p>
    </div>
  }
  if (!changed.size) {
    return <div className="grid gap-2 p-4 text-xs text-foreground-3">
      <p className="font-medium text-foreground-2">行级排序（研究）</p>
      <p>当前文件没有解析到新增或修改的目标侧行；不把删除行或整份源码算作候选。</p>
    </div>
  }
  if (head.isLoading) {
    return <p role="status" className="flex items-center gap-2 p-4 text-xs text-foreground-3">
      <LoaderCircle className="animate-spin" aria-hidden="true"/>正在读取目标源码
    </p>
  }
  if (head.error) {
    return <div className="grid gap-2 p-4 text-xs">
      <p role="alert" className="text-rose-deep">{errorMessage(head.error)}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void head.refetch()}>重试读取源码</Button>
    </div>
  }
  if (scored.isLoading) {
    return <p role="status" className="flex items-center gap-2 p-4 text-xs text-foreground-3">
      <LoaderCircle className="animate-spin" aria-hidden="true"/>正在按行排序
    </p>
  }
  if (scored.error) {
    return <div className="grid gap-2 p-4 text-xs">
      <p role="alert" className="text-rose-deep">{errorMessage(scored.error)}</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void scored.refetch()}>重试行级排序</Button>
    </div>
  }
  if (!rows.length) {
    return <p className="p-4 text-xs text-foreground-3">新增/修改行中没有模型可排序的非空代码行。</p>
  }

  return <div className="grid gap-2 p-3" aria-label="行级排序（研究）">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">行级排序（研究）</h3>
      <span className="text-[11px] text-foreground-3">{rows.length}/{changed.size} 行有排序</span>
    </div>
    <p className="flex items-start gap-1.5 rounded-sm border border-border-soft bg-card px-2 py-1.5 text-[11px] leading-body text-foreground-3">
      <TriangleAlert aria-hidden="true" focusable="false" strokeWidth={1.5} size={13} className="mt-0.5 shrink-0"/>
      研究排序，不是缺陷概率；只帮助决定先看哪一行，不改变提交分数，也不阻断合并。
    </p>
    {head.data && !head.data.complete ? <p className="text-[11px] text-amber-deep">目标源码未完整读取，行号可能不完整。</p> : null}
    <ol className="grid gap-1.5">
      {rows.map((row, index) => <li key={row.line} className="grid gap-1 rounded-sm border border-border-soft bg-card px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-foreground-4">{index + 1}</span>
          <code className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground-3">L{row.line}</code>
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground-2" title={row.text}>{row.text || ' '}</code>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">{row.score.toFixed(3)}</span>
          <Button type="button" size="icon-xs" variant="ghost" aria-label={`定位目标第 ${row.line} 行`}
            onClick={() => onLocate(row.line)}><LocateFixed aria-hidden="true"/></Button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-strong"><span className="block h-full bg-accent" style={{ width: `${Math.max(2, row.score * 100)}%` }}/></div>
        {row.contributions.length ? <details className="text-[11px] text-foreground-3">
          <summary className="cursor-pointer select-none">行级特征贡献</summary>
          <div className="mt-1 grid gap-1 sm:grid-cols-3">
            {row.contributions.map(item => <div key={item.feature} className="rounded-sm bg-sunken px-1.5 py-1">
              <span className="text-foreground-2">{lineFeatureLabel(item.feature)}</span>
              <span className="ml-1">值 {item.value.toFixed(2)} · 贡献 {signed(item.contribution)}</span>
            </div>)}
          </div>
          <p className="mt-1">行级特征贡献，不是缺陷原因。</p>
        </details> : null}
      </li>)}
    </ol>
  </div>
}
