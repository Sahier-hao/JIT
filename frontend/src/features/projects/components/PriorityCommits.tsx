import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CommitEvidenceBadge } from '@/features/projects/components/CommitEvidenceBadge'
import { fetchRepositorySyncCommits } from '@/lib/apiClient'
import { PARTITION_LABELS, type SyncCommitPage } from '@/features/projects/repositoryContract'
import type { AnalysisScope, RepositoryDistribution } from '@/features/projects/repositoryWorkspace'

export type ScopeView = 'holdout' | 'test' | 'all'

export function PriorityCommits({ syncId, scope, distribution, activeView, onOpenCommit, onOpenAll }: {
  syncId: string
  scope: AnalysisScope | null
  distribution: RepositoryDistribution
  activeView: ScopeView
  onOpenCommit: (commitId: string) => void
  onOpenAll: () => void
}) {
  const [page, setPage] = useState<SyncCommitPage | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const limit = activeView === 'all' ? 3 : 200
  useEffect(() => {
    const controller = new AbortController()
    setError(false)
    fetchRepositorySyncCommits(syncId, limit, 0, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.syncId !== syncId) setError(true)
      else setPage(result)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [syncId, limit, attempt])

  const current = page?.syncId === syncId && page.limit >= limit ? page : null
  const rows = current?.commits.filter(commit => activeView === 'all' || commit.partition === activeView) ?? []
  const preview = rows.slice(0, 3)
  const partition = activeView === 'holdout' ? scope?.split?.holdout : activeView === 'test' ? scope?.split?.test : null
  const fullyLoaded = partition?.count != null && rows.length === partition.count && rows.length > 0
  const total = distribution.high + distribution.medium + distribution.low + distribution.unknown

  return <section className="grid gap-3 rounded-md border border-border-soft bg-card p-card" aria-label="提交分数与缺陷证据">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="grid gap-0.5">
        <h3 className="text-base font-semibold text-foreground">优先回查的提交</h3>
        <p className="text-xs text-foreground-3">{total.toLocaleString()} 条已评分 · 按模型分数查看历史提交</p>
      </div>
      <Button onClick={onOpenAll} type="button">查看提交明细</Button>
    </div>
    {fullyLoaded && partition?.positives != null ? <p className="text-xs text-foreground-3">
      {activeView === 'holdout' ? '留出' : '测试集'} {rows.length} 条 · {partition.positives} 条有缺陷证据 · 前 {preview.length} 条有 {preview.filter(commit => commit.label === 1).length} 条
    </p> : null}
    {error ? <div className="flex flex-wrap items-center gap-2" role="alert">
      <span className="text-sm text-rose">提交预览读取失败</span>
      <Button variant="outline" size="sm" type="button" onClick={() => { setError(false); setAttempt(value => value + 1) }}>重新读取</Button>
    </div> : !current ? <p className="text-sm text-foreground-3" role="status">正在读取提交…</p>
      : preview.length ? <ul className="grid gap-1">
        {preview.map(commit => <li key={commit.commitId} className="border-t border-border-soft">
          <Button variant="ghost" type="button" onClick={() => onOpenCommit(commit.commitId)}
            className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 whitespace-normal px-2 py-2 text-left sm:grid-cols-[minmax(0,1fr)_7rem_8.5rem]">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" title={commit.subject ?? undefined}>{commit.subject ?? '未提供标题'}</span>
              <span className="block text-xs text-foreground-3"><code>{commit.commitId.slice(0, 7)}</code>{commit.partition && commit.partition !== 'scored' ? ` · ${PARTITION_LABELS[commit.partition]}` : ''}</span>
            </span>
            <span className="text-right text-sm tabular-nums sm:text-left"><span className="mr-1 text-xs text-foreground-3">分数</span>{commit.risk.toFixed(2)}</span>
            <span className="justify-self-start"><CommitEvidenceBadge status={commit.labelStatus}/></span>
          </Button>
        </li>)}
      </ul> : <p className="text-sm text-foreground-3">{current.total > current.limit ? '已读取的高分提交中没有该范围的条目。' : '当前范围没有提交。'}</p>}
    <details className="border-t border-border-soft pt-2 text-xs text-foreground-3">
      <summary className="cursor-pointer">模型分数分布</summary>
      <p className="mt-2">≥ 0.25 {distribution.high} 条 · 0.10–0.25 {distribution.medium} 条 · &lt; 0.10 {distribution.low} 条{distribution.unknown ? ` · 未评分 ${distribution.unknown} 条` : ''}</p>
    </details>
  </section>
}
