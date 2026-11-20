import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyQuery, displayTime, emptyQuery, readSeedQuery, validRisk, type Commit, type Dataset, type Query, toCommit } from '@/lib/domain'
import { CommitDetail } from '@/features/projects/components/CommitDetail'
import { CommitEvidenceBadge } from '@/features/projects/components/CommitEvidenceBadge'

import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'



import { analysisRoute, repositoryRoute, type Route } from '@/app/navigation'
import { useRepository, useRepositoryCommits, useRepositoryCommitRecords, type RepositoryDetail } from '@/features/projects/repositoryWorkspace'

import { DEGRADE_LABELS, PARTITION_LABELS, STATUS_LABELS, type CommitPartition } from '@/features/projects/repositoryContract'
import { useModelName } from '@/features/models/modelClient'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

/** 风险分档与三色一一对应：高 ≥25%、中 10–25%、低 <10%（repo-distribution-v1）。 */
function riskTone(risk: number | null | undefined): 'high' | 'medium' | 'low' | 'unknown' {
  if (risk === null || risk === undefined || !Number.isFinite(risk)) return 'unknown'
  if (risk >= 0.25) return 'high'
  if (risk >= 0.1) return 'medium'
  return 'low'
}

const TONE_FILL: Record<string, string> = { high: 'bg-rose', medium: 'bg-amber', low: 'bg-teal', unknown: 'bg-foreground-4' }
const PARTITION_CLASS: Record<string, string> = {
  holdout: 'bg-blue-soft text-blue-deep',
  test: 'bg-amber-soft text-amber-deep',
  validation: 'bg-teal-soft text-teal-deep',
  train: 'bg-soft text-foreground-3',
}

/** 旧数据里 risk 是 unknown，界面只接受 0–1 的有限数；其余按"未知"处理。 */
function safeRisk(value: unknown): number | null {
  return validRisk(value) ? value : null
}

function scoreText(risk: number | null | undefined): string {
  return risk === null || risk === undefined || !Number.isFinite(risk) ? '—' : risk.toFixed(2)
}

function RepositoryHead({ repository, total }: { repository: RepositoryDetail; total: number }) {
  const { high, medium, low, unknown } = repository.distribution
  const segments = [
    { key: 'high', value: high },
    { key: 'medium', value: medium },
    { key: 'low', value: low },
  ].filter(segment => segment.value > 0)
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border-soft pb-4">
      <div className="grid gap-1">
        <h1 className="font-sans text-xl font-semibold leading-title text-foreground">{repository.displayName}</h1>
        <p className="text-xs text-foreground-3">
          {repository.viewContext?.completedAt ? `分析完成 ${displayTime(repository.viewContext.completedAt)}` : '旧分析未记录完成时间'}
          <span className="mx-1.5 text-foreground-4" aria-hidden="true">·</span>
          {repository.viewContext?.branch ?? '未提供'} 分支
          <span className="mx-1.5 text-foreground-4" aria-hidden="true">·</span>
          {total.toLocaleString()} 个已分析提交
        </p>
      </div>
      <div className="grid w-56 gap-1.5">
        <div
          className="flex h-2 overflow-hidden rounded-full bg-strong"
          role="img"
          aria-label={`风险分布：高 ${high}，中 ${medium}，低 ${low}${unknown ? `，未知 ${unknown}` : ''}`}
        >
          {segments.length === 0
            ? <i className="h-full flex-1 bg-foreground-4" />
            : segments.map(segment => (
              <i key={segment.key} className={cn('h-full', TONE_FILL[segment.key])} style={{ flex: segment.value }} />
            ))}
        </div>
        <p className="flex justify-between text-[11px] text-foreground-3">
          <span className="text-rose-deep">高 {high}</span>
          <span className="text-amber-deep">中 {medium}</span>
          <span className="text-teal-deep">低 {low}</span>
        </p>
      </div>
    </header>
  )
}

function ReviewTable({ commits, onOpen }: { commits: Commit[]; onOpen: (id: string, trigger: HTMLButtonElement) => void }) {
  return (
    <Table><caption className="sr-only">分支提交及缺陷引入证据</caption><TableHeader><TableRow><TableHead>提交</TableHead><TableHead>模型分数</TableHead><TableHead>缺陷引入证据</TableHead><TableHead className="text-right tabular-nums">变更行</TableHead><TableHead className="text-right tabular-nums">文件</TableHead></TableRow></TableHeader><TableBody>{commits.map(commit => {
          const tone = riskTone(safeRisk(commit.risk))
          return (
            <TableRow key={commit.id} data-tone={tone}><TableCell><div className="flex items-start gap-2">
                  <i className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE_FILL[tone])} aria-hidden="true" />
                  <div className="min-w-0">
                    <Button variant="ghost"
                      type="button"
                      className="h-auto min-w-0 block max-w-full whitespace-normal border-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      title={commit.id}
                      aria-label={`查看 ${commit.id}`}
                      onClick={event => onOpen(commit.id, event.currentTarget)}
                    >
                      <span className="block truncate text-sm font-medium text-foreground">{commit.title || '未提供标题'}</span>
                      <code className="font-mono text-xs text-foreground-3">{commit.id.slice(0, 8)}</code>
                    </Button>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-foreground-3">
                      {commit.partition && PARTITION_LABELS[commit.partition as CommitPartition]
                        ? <span className={cn('rounded-sm px-1 py-0.5 text-[11px]', PARTITION_CLASS[commit.partition] ?? 'bg-soft text-foreground-3')}>{PARTITION_LABELS[commit.partition as CommitPartition]}</span> : null}
                      <span>{commit.authorName || '作者未提供'} · </span>
                      <time dateTime={commit.time}>{displayTime(commit.time).slice(0, 16)}</time>
                    </span>
                  </div>
                </div></TableCell><TableCell><div className="flex items-center gap-2">
                  <b className="tabular-nums text-foreground">{scoreText(safeRisk(commit.risk))}</b>
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-strong" aria-hidden="true">
                    <i className={cn('block h-full rounded-full', TONE_FILL[tone])} style={{ width: `${Math.round((safeRisk(commit.risk) ?? 0) * 100)}%` }} />
                  </span>
                </div></TableCell><TableCell><CommitEvidenceBadge status={commit.labelStatus}/></TableCell><TableCell className="text-right tabular-nums">{commit.lines === undefined ? '—' : commit.lines.toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{commit.files === undefined ? '—' : commit.files.toLocaleString()}</TableCell></TableRow>
          )
        })}</TableBody></Table>
  )
}

export interface ReviewWorkbenchProps {
  repositoryId: string
  viewSyncId: string
  commitId?: string
  stateKey: string
  drafts: Map<string, ReviewDraft>
  navigate: (route: Route) => void
}

export type ReviewDraft = { draft: Query; applied: Query; error: string; offset: number }
export function ReviewWorkbench({ repositoryId, viewSyncId, commitId, stateKey, drafts: reviewDrafts, navigate }: ReviewWorkbenchProps) {
  const repository = useRepository(repositoryId, viewSyncId)
  const modelName = useModelName(repository.repository?.modelId)
  const [seed] = useState(() => readSeedQuery(window.location.search))
  const [queryState, setQueryState] = useState(() => reviewDrafts.get(stateKey) ?? { draft: seed.query, applied: seed.query, error: '' })
  const [offset, setOffset] = useState(() => reviewDrafts.get(stateKey)?.offset ?? 0)
  const selected = commitId ?? null
  const setSelected = useCallback((id: string | null) => {
    navigate(analysisRoute(repositoryId, viewSyncId, id ? { commitId: id } : {}))
  }, [navigate, repositoryId, viewSyncId])
  const page = useRepositoryCommits(repository.repository ? repositoryId : '', queryState.applied, offset, PAGE_SIZE, viewSyncId)
  const detailRecords = useRepositoryCommitRecords(repositoryId, selected ? [selected] : [], viewSyncId)
  const totalMismatch = page.state === 'ready' && !queryState.applied.search.trim() && !queryState.applied.start && !queryState.applied.end && repository.repository !== null && page.total !== repository.repository.commitCount
  const visible: Commit[] = totalMismatch ? [] : page.commits.map(toCommit)
  const dataset: Dataset = useMemo(() => ({
    mode: 'repository',
    project: repository.repository?.displayName ?? '',
    version: repository.repository?.datasetVersion ?? '未登记数据集',
    records: [],
    repository: repository.repository ? {
      modelId: repository.repository.modelId,
      runId: repository.repository.runId,
      repositoryId,
      syncId: viewSyncId,
      repositoryUrl: repository.repository.url,
      branch: repository.repository.viewContext?.branch ?? '未提供',
      datasetVersion: repository.repository.datasetVersion ?? '',
      requestedStrategy: 'auto',
      modelStrategy: repository.repository.modelStrategy ?? null,
      degradeReason: repository.repository.degradeReason ?? null,
      trainRecords: null,
      trainPositives: null,
      labelNote: '缺陷引入证据由历史修复回溯收集',
    } : undefined,
  }), [repository.repository, repositoryId, viewSyncId])
  useEffect(() => { reviewDrafts.set(stateKey, { ...queryState, offset }) }, [stateKey, queryState, offset, reviewDrafts])

  function updateQuery(patch: Partial<Query>) {
    setOffset(0)
    setQueryState(previous => {
      const draft = { ...previous.draft, ...patch }
      const result = applyQuery(previous.applied, draft)
      return { draft, applied: result.query, error: result.error }
    })
  }

  function clearQuery() {
    setOffset(0)
    setQueryState({ draft: emptyQuery, applied: emptyQuery, error: '' })
  }

  function closeDetail() {
    setSelected(null)
  }
  useEffect(() => {
    if (selected && page.state === 'ready' && page.total === 0) setSelected(null)
  }, [selected, page.state, page.total, setSelected])

  if (repository.state === 'loading' && repository.repository === null) {
    return <LoadingNotice prefix={false} label="正在读取仓库" note="读取仓库详情、风险分布与提交列表。" />
  }
  if (repository.state === 'error') {
    return (
      <EmptyState tone="alert" title="仓库读取失败" description={repository.error}>
        <Button variant='default' onClick={repository.retry} type="button">重新加载</Button>
      </EmptyState>
    )
  }
  if (repository.repository === null) {
    return (
      <EmptyState title="仓库不存在" description="这个地址对应的仓库已经不在目录里。">
        <Button variant='default' onClick={() => navigate({ name: 'repositories' })} type="button">查看全部仓库</Button>
      </EmptyState>
    )
  }

  const repo = repository.repository
  const first = page.total === 0 ? 0 : offset + 1
  const last = Math.min(offset + PAGE_SIZE, page.total)
  const fieldLabel = 'grid gap-1'
  const labelText = 'text-xs text-foreground-3'

  return (
    <div className="grid gap-4">
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => navigate(repositoryRoute(repositoryId))} aria-label={`返回项目 ${repo.displayName}`} title={`返回项目 ${repo.displayName}`} type="button">{<ChevronLeft aria-hidden="true" focusable="false" strokeWidth={1.5} size={16}/>}返回项目</Button>
      <RepositoryHead repository={repo} total={repo.commitCount} />
      <details className="rounded-sm border border-border-soft">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-foreground-3">
          <span className="rounded-sm bg-soft px-1.5 py-0.5 text-foreground-2">仓库分析 · {repo.viewContext?.branch ?? '分支未提供'}</span>
          <span className="inline-flex items-center gap-1">分析来源 <ChevronRight aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></span>
        </summary>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-soft p-3 text-xs text-foreground-3">
          <span>分析 <code className="font-mono text-foreground-2">{viewSyncId}</code></span>
          <span>HEAD <code className="font-mono text-foreground-2">{repo.viewContext?.headCommit ?? '旧记录未提供'}</code></span>
          <span>数据 <code className="font-mono text-foreground-2">{repo.datasetVersion ?? '未提供'}</code></span>
          <span>模型 <code className="font-mono text-foreground-2">{repo.modelId ?? '未提供'}</code></span>
          <span>运行 <code className="font-mono text-foreground-2">{repo.runId ?? '未提供'}</code></span>
          <span>{repo.modelStrategy === 'generic-model' ? '通用模型' : repo.modelStrategy === 'repository-trained' ? '仓库模型' : '模型来源未提供'}{repo.degradeReason ? ` · ${DEGRADE_LABELS[repo.degradeReason] ?? repo.degradeReason}` : ''}</span>
        </div>
      </details>
      {repo.latestSync?.syncId !== viewSyncId ? <p className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">最近作业：{repo.latestSync ? STATUS_LABELS[repo.latestSync.status] : '未提供'}。当前仍查看固定的成功分析。
        {repo.latestSync?.status === 'completed' ? <><Button variant="link" size="sm" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: repo.latestSync!.syncId, view: 'commits' })} type="button">打开新结果</Button><Button variant="link" size="sm" onClick={() => navigate({ name: 'comparison', repositoryId, baseSyncId: viewSyncId, targetSyncId: repo.latestSync!.syncId })} type="button">对比新结果</Button></> : <Button variant="link" size="sm" onClick={() => navigate(repositoryRoute(repositoryId))} type="button">检查最新成功分析</Button>}
      </p> : null}
      <p className="text-xs leading-body text-foreground-3">{modelName ? `模型 ${modelName} · ` : ''}模型分数用于排序，缺陷引入证据来自后续修复回溯。</p>

      <section className="grid gap-3" aria-label="已分析提交">
        <div className="flex flex-wrap items-end gap-2" role="search" aria-label="提交筛选">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">搜索提交标题或 SHA</span>
            <Search aria-hidden="true" focusable="false" strokeWidth={1.5} size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-4"/>
            <Input className="pl-8" aria-label="搜索提交标题或 SHA" placeholder="搜索提交标题或 SHA" value={queryState.draft.search} onChange={event => updateQuery({ search: event.target.value })}/>
          </label>
          <label className={fieldLabel}><span className={labelText}>起始日期</span>
            <Input className="w-36" aria-label="起始日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.start} aria-invalid={!!queryState.error} onChange={event => updateQuery({ start: event.target.value })}/>
          </label>
          <label className={fieldLabel}><span className={labelText}>结束日期</span>
            <Input className="w-36" aria-label="结束日期" inputMode="numeric" placeholder="YYYY-MM-DD" value={queryState.draft.end} aria-invalid={!!queryState.error} onChange={event => updateQuery({ end: event.target.value })}/>
          </label>
          <label className={fieldLabel}><span className={labelText}>排序</span>
            <NativeSelect className="w-40" aria-label="排序" value={queryState.draft.sort} onChange={event => updateQuery({ sort: event.target.value as Query['sort'] })}><option value="risk">风险从高到低</option><option value="time">时间从新到旧</option></NativeSelect>
          </label>
          <Button onClick={clearQuery} variant="outline" type="button">清除筛选</Button>
        </div>
        {queryState.error ? <p className="text-xs text-amber-deep" role="alert">{queryState.error} 当前保留最近一次有效结果。</p> : null}
        <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground-3">
          <span>提交 / 改动 <b className="text-foreground">{page.total.toLocaleString()}</b></span>
          <span>时间口径 Asia/Shanghai (UTC+08:00) · 按{queryState.applied.sort === 'risk' ? '模型分数' : '时间'}排序</span>
        </p>
        {page.state === 'loading' && visible.length === 0
          ? <LoadingNotice prefix={false} label="正在读取提交" note="按当前筛选条件从服务端读取这一页。" />
          : page.state === 'error' || totalMismatch
            ? <EmptyState tone="alert" title="提交读取失败" description={totalMismatch ? '提交总数与固定分析不一致，请重新加载核对。' : page.error}><Button variant='default' onClick={page.retry} type="button">重新加载</Button></EmptyState>
            : visible.length === 0
              ? <EmptyState title="没有符合条件的提交" description="使用「清除筛选」恢复列表，或换一个查询条件。" />
              : <>
                <div className="min-w-0 overflow-x-auto"><ReviewTable commits={visible} onOpen={id => setSelected(id)} /></div>
                <nav className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-3" aria-label="提交分页">
                  <span role="status">第 {first}–{last} 条，共 {page.total.toLocaleString()} 条</span>
                  <span className="flex gap-2">
                    <Button disabled={offset === 0 || page.state === 'loading'} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} variant="outline" type="button">上一页</Button>
                    <Button disabled={offset + PAGE_SIZE >= page.total || page.state === 'loading'} onClick={() => setOffset(offset + PAGE_SIZE)} variant="outline" type="button">下一页</Button>
                  </span>
                </nav>
              </>}
      </section>

      <Dialog open={selected !== null} onOpenChange={open => { if (!open) closeDetail() }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${720}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"提交详情"}</DialogTitle></DialogHeader>{selected && (detailRecords.state === 'loading' || detailRecords.state === 'idle') ? (
        <LoadingNotice label="正在读取提交及修复证据"/>
      ) : selected ? (
          <CommitDetail
            data={dataset}
            id={selected}
            record={detailRecords.records.get(selected) ?? visible.find(record => record.id === selected)}
            onClose={closeDetail}
          />
        ) : null}</DialogContent></Dialog>
    </div>
  )
}
