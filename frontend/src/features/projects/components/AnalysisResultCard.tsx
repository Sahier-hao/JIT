import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EChartCanvas, useChartColors } from '@/components/shared/EChartCanvas'
import { fetchRepositorySyncCommits } from '@/lib/apiClient'
import { PARTITION_LABELS, type SyncCommit } from '@/features/projects/repositoryContract'
import type { AnalysisScope, RepositoryDistribution } from '@/features/projects/repositoryWorkspace'
import { AnalysisScopeCard } from '@/features/projects/components/AnalysisScopeCard'
import { CommitEvidenceBadge } from '@/features/projects/components/CommitEvidenceBadge'
import {
  HIGH_THRESHOLD, MID_THRESHOLD, SCORE_BIN, bandColors, bandsOption, histogramOption,
} from '@/features/projects/analysisScore'

export type ScopeView = 'holdout' | 'test' | 'all'

const PAGE_SIZE = 200
/** 分布图按完整提交集绘制；超过上限就退回按分档统计，不抽样。 */
const COMMIT_CAP = 800

function viewLabel(view: ScopeView, scope: AnalysisScope | null) {
  if (view === 'holdout') return `留出 ${scope?.split?.holdout.count ?? '—'} 条`
  if (view === 'test') return `测试 ${scope?.split?.test.count ?? '—'} 条`
  return '全部提交'
}

export function AnalysisResultCard({ syncId, scope, distribution, activeView, historical = false, notice, note, viewSwitch, onOpenCommit, onOpenAll, onOpenDataset }: {
  syncId: string
  scope: AnalysisScope | null
  distribution: RepositoryDistribution
  activeView: ScopeView
  historical?: boolean
  notice?: string
  note?: string
  viewSwitch?: ReactNode
  onOpenCommit: (commitId: string) => void
  onOpenAll: () => void
  onOpenDataset: () => void
}) {
  const colors = useChartColors()
  const [commits, setCommits] = useState<SyncCommit[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [sourceOpen, setSourceOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setCommits(null)
    setTotal(0)
    setError(false)
    void (async () => {
      try {
        const loaded: SyncCommit[] = []
        let offset = 0
        let count = 0
        do {
          const page = await fetchRepositorySyncCommits(syncId, PAGE_SIZE, offset, controller.signal)
          if (controller.signal.aborted) return
          if (page.syncId !== syncId) { setError(true); return }
          count = page.total
          loaded.push(...page.commits)
          offset += PAGE_SIZE
          if (page.commits.length < PAGE_SIZE) break
        } while (offset < Math.min(count, COMMIT_CAP))
        if (!controller.signal.aborted) { setCommits(loaded); setTotal(count) }
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    })()
    return () => controller.abort()
  }, [syncId, attempt])

  const rows = useMemo(() => !commits ? [] : activeView === 'all' ? commits : commits.filter(commit => commit.partition === activeView),
    [commits, activeView])
  const top = useMemo(() => [...rows].sort((a, b) => b.risk - a.risk).slice(0, 3), [rows])
  const complete = commits !== null && commits.length >= total
  const scored = distribution.high + distribution.medium + distribution.low
  const partition = activeView === 'holdout' ? scope?.split?.holdout : activeView === 'test' ? scope?.split?.test : null
  const fullyLoaded = partition?.count != null && rows.length === partition.count && rows.length > 0
  const palette = bandColors(colors)
  const option = useMemo(
    () => complete && rows.length ? histogramOption(rows, colors) : bandsOption(distribution, colors),
    [complete, rows, colors, distribution],
  )
  const sourceLine = [scope
    ? [scope.model.name ?? '模型身份未记录', scope.model.algorithmName, scope.model.featureSchemaVersion, scope.strategy === 'repository-trained' ? '项目自训模型' : '现成模型'].filter(Boolean).join(' · ')
    : '现成模型 · 没有在本项目训练，也没有本地训练/测试集', note].filter(Boolean).join(' · ')

  return <section className="grid gap-4 rounded-md border border-border-soft bg-card p-card" aria-label="当前分析结果">
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">模型分数分布
          {historical ? <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] font-normal text-foreground-3">历史固定结果</span> : null}
        </h3>
        <span className="text-xs tabular-nums text-foreground-3">{viewLabel(activeView, scope)} · {scored.toLocaleString()} 条已评分{distribution.unknown ? ` · ${distribution.unknown.toLocaleString()} 条未评分` : ''}</span>
      </div>
      {viewSwitch}
      {notice ? <p className="text-xs text-foreground-3">{notice}</p> : null}
      <p className="text-xs text-foreground-3">
        {complete && rows.length ? `每 ${SCORE_BIN.toFixed(2)} 一档` : '按分档统计'}
        {` · 阈值 ${HIGH_THRESHOLD.toFixed(2)} / ${MID_THRESHOLD.toFixed(2)} · 分数是未校准的模型估计`}
      </p>
      {error && !commits ? <div className="flex flex-wrap items-center gap-2" role="alert">
        <span className="text-sm text-rose">提交读取失败，无法绘制分布</span>
        <Button variant="outline" size="sm" type="button" onClick={() => setAttempt(value => value + 1)}>重新读取</Button>
      </div> : commits === null ? <p className="py-8 text-center text-sm text-foreground-3" role="status">正在读取提交…</p>
        : <EChartCanvas option={option} height={210} label="模型分数分布柱状图"/>}
      <ul aria-label="分档数量" className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-foreground-3">
        <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: palette.high }} aria-hidden="true"/>{HIGH_THRESHOLD.toFixed(2)} 及以上 {distribution.high.toLocaleString()} 条</li>
        <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: palette.medium }} aria-hidden="true"/>{MID_THRESHOLD.toFixed(2)} – {HIGH_THRESHOLD.toFixed(2)} {distribution.medium.toLocaleString()} 条</li>
        <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: palette.low }} aria-hidden="true"/>{MID_THRESHOLD.toFixed(2)} 以下 {distribution.low.toLocaleString()} 条</li>
        {distribution.unknown ? <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: palette.unknown }} aria-hidden="true"/>未评分 {distribution.unknown.toLocaleString()} 条</li> : null}
      </ul>
    </div>

    <div className="grid gap-2 border-t border-border-soft pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="text-base font-semibold text-foreground">优先回查的提交</h3>
          <p className="text-xs text-foreground-3">按模型分数查看历史提交</p>
        </div>
        <Button onClick={onOpenAll} type="button">查看提交明细</Button>
      </div>
      {fullyLoaded && partition?.positives != null ? <p className="text-xs text-foreground-3">
        {activeView === 'holdout' ? '留出' : '测试集'} {rows.length} 条 · {partition.positives} 条有缺陷证据 · 前 {top.length} 条有 {top.filter(commit => commit.label === 1).length} 条
      </p> : null}
      {error && !commits ? <div className="flex flex-wrap items-center gap-2" role="alert">
        <span className="text-sm text-rose">提交预览读取失败</span>
        <Button variant="outline" size="sm" type="button" onClick={() => setAttempt(value => value + 1)}>重新读取</Button>
      </div> : commits === null ? <p className="text-sm text-foreground-3" role="status">正在读取提交…</p>
        : top.length ? <ul className="grid gap-1">
          {top.map(commit => <li key={commit.commitId} className="border-t border-border-soft">
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
        </ul> : <p className="text-sm text-foreground-3">当前范围没有提交。</p>}
    </div>

    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-soft pt-3">
      <h3 className="shrink-0 text-base font-semibold text-foreground">模型与数据来源</h3>
      <p className="min-w-0 flex-1 truncate text-xs text-foreground-3" title={sourceLine}>{sourceLine}</p>
      {scope ? <Button size="sm" variant="ghost" onClick={() => setSourceOpen(true)} type="button">查看完整口径</Button>
        : <Button size="sm" variant="ghost" onClick={onOpenDataset} type="button">数据来源</Button>}
    </div>

    <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{ width: 'min(92vw, 640px)', maxWidth: 'none' }}>
        <DialogHeader><DialogTitle>模型与数据来源</DialogTitle></DialogHeader>
        {scope ? <AnalysisScopeCard scope={scope} bare onOpenDataset={() => { setSourceOpen(false); onOpenDataset() }}/> : null}
      </DialogContent>
    </Dialog>
  </section>
}
