import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { fetchRepositorySyncCommits } from '@/lib/apiClient'
import { PARTITION_LABELS, type SyncCommit } from '@/features/projects/repositoryContract'
import type { AnalysisScope, RepositoryDistribution } from '@/features/projects/repositoryWorkspace'

const PARTITION_CLASS: Record<string, string> = {
  holdout: 'bg-blue-soft text-blue-deep',
  test: 'bg-amber-soft text-amber-deep',
  validation: 'bg-teal-soft text-teal-deep',
  train: 'bg-soft text-foreground-3',
}

/** 读取本次分析最多 200 条提交，由面板按分区筛选后再取前三。 */
function useAnalysisCommits(syncId?: string) {
  const [items, setItems] = useState<SyncCommit[]>([])
  useEffect(() => {
    if (!syncId) { setItems([]); return }
    const controller = new AbortController()
    fetchRepositorySyncCommits(syncId, 200, 0, controller.signal)
      .then(page => setItems(page.commits))
      .catch(() => setItems([]))
    return () => controller.abort()
  }, [syncId])
  return items
}

export type ScopeView = 'holdout' | 'test' | 'all'

/** 分数分布与分区内前三名：只作回放与复盘，不承担改动审查。 */
export function PriorityCommits({ syncId, scope, distribution, activeView }: {
  syncId?: string
  scope: AnalysisScope | null
  distribution: RepositoryDistribution
  activeView: ScopeView
}) {
  const commits = useAnalysisCommits(syncId)
  const total = distribution.high + distribution.medium + distribution.low + distribution.unknown
  const share = (count: number) => total ? Math.round((count / total) * 100) : 0
  const viewCommits = commits
    .filter(commit => activeView === 'all' || commit.partition === activeView)
    .sort((left, right) => right.risk - left.risk)
  const priorityCommits = viewCommits.slice(0, 3)
  const partitionTotal = activeView === 'holdout' ? scope?.split?.holdout.count ?? null
    : activeView === 'test' ? scope?.split?.test.count ?? null : null
  const partitionPositives = activeView === 'holdout' ? scope?.split?.holdout.positives ?? null
    : activeView === 'test' ? scope?.split?.test.positives ?? null : null
  // 只有加载覆盖了整个分区时，前三名才是该分区真正的前三名。
  const replayComplete = partitionTotal != null && partitionTotal > 0 && viewCommits.length >= partitionTotal
  const replaySummary = activeView !== 'all' && replayComplete && partitionPositives != null
    ? `${activeView === 'holdout' ? '留出' : '测试集'} ${partitionTotal} 条 · ${partitionPositives} 条有缺陷证据 · 分数最高的三条命中 ${priorityCommits.filter(commit => commit.label === 1).length} 条`
    : ''
  const viewTitle = activeView === 'holdout' ? '模型没见过的提交里，分数最高的三条'
    : activeView === 'test' ? '测试集里分数最高的三条' : '全部分数最高的三条'
  const priorityNote = activeView === 'holdout'
    ? '分支分析用于回放与复盘，不承担改动审查；待审查的改动在「PR 审查」。'
    : activeView === 'all' ? '包含模型训练或调参时见过的提交，分数只反映拟合程度。'
      : '测试集只用于评估模型，不是待审查清单。'

  return <>
    <div className="grid gap-4 rounded-md border border-border-soft bg-card p-card sm:grid-cols-[160px_minmax(0,1fr)]">
      <div className="grid content-center gap-1">
        <b className="text-2xl font-semibold tabular-nums text-foreground">{total.toLocaleString()}</b>
        <span className="text-xs text-foreground-3">{activeView === 'holdout' ? '模型没见过的提交' : activeView === 'test' ? '测试集提交' : '已分析提交'}</span>
      </div>
      <div className="grid gap-2">
        <p className="text-xs text-foreground-3">模型分数分布（未校准）</p>
        <ul className="grid gap-1.5" aria-label={`模型分数分布：≥0.25 ${distribution.high} 条、0.10 到 0.25 ${distribution.medium} 条、小于 0.10 ${distribution.low} 条`}>
          {([
            ['≥ 0.25', distribution.high, 'bg-rose'],
            ['0.10–0.25', distribution.medium, 'bg-amber'],
            ['< 0.10', distribution.low, 'bg-teal'],
          ] as const).map(([label, count, fill]) => <li key={label} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 tabular-nums text-foreground-3">{label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-strong"><span className={cn('block h-full rounded-full', fill)} style={{ width: `${share(count)}%` }}/></span>
            <span className="flex w-20 shrink-0 items-baseline justify-end gap-1 tabular-nums"><b className="text-foreground">{count.toLocaleString()}</b><em className="not-italic text-foreground-4">{share(count)}%</em></span>
          </li>)}
        </ul>
      </div>
    </div>

    {priorityCommits.length ? <div className="grid gap-2 rounded-md border border-border-soft bg-card p-card">
      <p className="text-sm font-medium text-foreground-2">{viewTitle}</p>
      {replaySummary ? <p className="text-xs text-foreground-3">{replaySummary}</p> : null}
      <ol>
        {priorityCommits.map((commit, index) => <li key={commit.commitId} className="flex items-center gap-2 border-t border-border-soft py-2 text-sm first:border-t-0">
          <span className="w-4 shrink-0 text-xs tabular-nums text-foreground-4" aria-hidden="true">{index + 1}</span>
          <code className="shrink-0 font-mono text-xs text-foreground-3">{commit.commitId.slice(0, 7)}</code>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {commit.partition ? <span className={cn('shrink-0 rounded-sm px-1 py-0.5 text-[11px]', PARTITION_CLASS[commit.partition] ?? 'bg-soft text-foreground-3')}>{PARTITION_LABELS[commit.partition]}</span> : null}
            <span className="truncate text-foreground-2" title={commit.subject ?? ''}>{commit.subject ?? '未提供标题'}</span>
            <span className={cn('shrink-0 rounded-sm px-1 py-0.5 text-[11px]', commit.label === 1 ? 'bg-rose-soft text-rose-deep' : 'bg-soft text-foreground-3')} title={commit.labelNote ?? ''}>
              {commit.label === 1 ? '有证据' : '未观测'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="h-1 w-16 overflow-hidden rounded-full bg-strong" aria-hidden="true"><span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(commit.risk * 100)}%` }}/></span>
            <b className="text-xs tabular-nums text-foreground">{commit.risk.toFixed(2)}</b>
          </span>
        </li>)}
      </ol>
      {priorityNote ? <p className="text-xs leading-body text-foreground-3">{priorityNote}</p> : null}
      <p className="text-xs leading-body text-foreground-3">分数是未校准的排序值，不是概率。</p>
    </div> : null}
  </>
}
