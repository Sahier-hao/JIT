import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { linkTo } from '@/app/navigation'

import { Button } from '@/components/ui/button'
import { LoaderCircle, ArrowLeft, Database } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'


import { useEffect, useRef, useState } from 'react'





import type { BranchAnalysisSeed } from '@/features/projects/components/AnalysisForm'
import { ACTIVE_STATUSES, DEGRADE_LABELS, type SyncView } from '@/features/projects/repositoryContract'
import { projectsChanged } from '@/features/projects/projectEvents'
import { AnalysisLauncher } from '@/features/projects/components/AnalysisLauncher'
import { RepositoryUpdates } from '@/features/projects/components/RepositoryUpdates'
import { RepositoryOverviewView } from '@/features/projects/components/RepositoryOverview'
import { ProjectPullRequests } from '@/features/projects/components/ProjectPullRequests'
import { ProjectAnalysisHistory } from '@/features/projects/components/ProjectAnalysisHistory'
import { JobProgress } from '@/features/projects/components/JobProgress'
import { ProjectTrends } from '@/features/projects/components/ProjectTrends'
import { ProjectDatasetDialog } from '@/features/projects/components/ProjectDatasetDialog'
import { AnalysisResultCard } from '@/features/projects/components/AnalysisResultCard'
import { RecordDetails, RecordRow } from '@/features/projects/components/AnalysisRecords'
import { getPRSnapshot } from '@/features/reviews/prReviewClient'
import { EmptyState } from '@/components/shared/Feedback'
import { ProjectPageSkeleton } from '@/components/shared/Skeletons'
import { analysisRoute, repositoryRoute, type Route } from '@/app/navigation'
import { cancelRepositorySync, deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '@/features/projects/projectClient'
import { projectStatus, type ProjectTone } from '@/features/projects/projectStatus'

import { useRepository } from '@/features/projects/repositoryWorkspace'
import { cn } from '@/lib/utils'

type ProjectTab = 'overview' | 'prs' | 'trends' | 'analyses'

const TONE_DOT: Record<ProjectTone, string> = { active: 'bg-blue', ok: 'bg-teal', alert: 'bg-rose', muted: 'bg-foreground-4' }

export function ProjectPage({ repositoryId, tab, viewId, navigate }: { repositoryId: string; tab?: ProjectTab; viewId?: string; navigate: (route: Route, replace?: boolean) => void }) {
  // 风险趋势不再是独立页签：地址仍保留 /trends[/viewId] 以支持旧链接，界面并入「分析」。
  const trendMode = tab === 'trends'
  const activeTab = trendMode ? 'analyses' : tab ?? 'overview'
  const branchView = activeTab === 'analyses'
  const detail = useRepository(repositoryId)
  // 记录在卡片内滚动查看：一次取最近 100 次，避免在卡片里翻页打断阅读。
  const records = useRepositorySyncs(branchView ? repositoryId : '', 100, 0)
  const refreshRecords = records.retry
  const [recordError, setRecordError] = useState('')
  const [selectingId, setSelectingId] = useState('')
  const [currentNotice, setCurrentNotice] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const cancelLock = useRef(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const deleteLock = useRef(false)
  useEffect(() => {
    if (!currentNotice) return
    const timer = window.setTimeout(() => setCurrentNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [currentNotice])
  const [detailJob, setDetailJob] = useState<SyncView | null>(null)
  const [deleteJob, setDeleteJob] = useState<SyncView | null>(null)
  const [cancelJob, setCancelJob] = useState<SyncView | null>(null)
  const [analysisSeed, setAnalysisSeed] = useState<{ key: number; form: BranchAnalysisSeed } | null>(null)
  const [openingPR, setOpeningPR] = useState(false)
  const [datasetOpen, setDatasetOpen] = useState(false)
  const [scopeView, setScopeView] = useState<'holdout' | 'test' | 'all'>('holdout')
  const openPRLock = useRef(false)
  const currentSyncId = detail.repository?.viewContext?.syncId
  useEffect(() => { setDatasetOpen(false) }, [currentSyncId])
  useEffect(() => {
    setScopeView(detail.repository?.viewContext?.scope?.split?.holdout.count ? 'holdout' : 'all')
  }, [currentSyncId, detail.repository?.viewContext?.scope?.split?.holdout.count])
  const latestStatus = detail.repository?.latestSync?.status
  const latestId = detail.repository?.latestSync?.syncId
  const previousJob = useRef('')
  useEffect(() => {
    const signature = `${latestId ?? ''}:${latestStatus ?? ''}`
    if (!latestStatus || previousJob.current === signature) return
    previousJob.current = signature
    refreshRecords()
    if (!ACTIVE_STATUSES.includes(latestStatus as typeof ACTIVE_STATUSES[number])) projectsChanged()
  }, [latestStatus, latestId, refreshRecords])

  if (detail.state === 'loading' && !detail.repository) return <ProjectPageSkeleton/>
  if (detail.state === 'error' || !detail.repository) {
    return <EmptyState title="项目读取失败" description={detail.error} tone="alert"><Button onClick={detail.retry} variant="outline" type="button">重新加载</Button><Button onClick={() => navigate({ name: 'repositories' })} variant="outline" type="button">返回项目列表</Button></EmptyState>
  }

  const repository = detail.repository
  const latest = repository.latestSync?.sourceKind !== 'pr' && repository.latestSync
    ? repository.latestSync
    : records.syncs.find(job => job.sourceKind !== 'pr')
  const activeJob = latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? latest : null
  const status = projectStatus(repository, latest)
  const context = repository.viewContext
  const scope = context?.scope ?? null
  const activeView = scope?.split ? scopeView : 'all'
  const shownDistribution = scope?.distributions[activeView] ?? repository.distribution
  const latestCompletedId = records.syncs.find(job => job.status === 'completed')?.syncId ?? null
  async function makeCurrent(job: SyncView) {
    if (selectingId !== '') return
    if (recordError !== '') setRecordError('')
    setSelectingId(job.syncId)
    try {
      await selectRepositoryView(repositoryId, job.syncId)
      detail.retry()
      records.retry()
      setCurrentNotice(`当前结果已切换为 ${job.syncId.slice(0, 7)}`)
    } catch (failure) {
      setCurrentNotice('')
      setRecordError(failure instanceof Error ? failure.message : '设置当前结果失败')
    } finally {
      setSelectingId('')
    }
  }
  async function removeRecord(job: SyncView) {
    if (deleteLock.current) return
    deleteLock.current = true; setDeleteBusy(true)
    if (recordError !== '') setRecordError('')
    try {
      await deleteRepositorySync(job.syncId)
      records.retry()
      detail.retry()
    } catch (failure) {
      setRecordError(failure instanceof Error ? failure.message : '删除分析记录失败')
    } finally {
      deleteLock.current = false; setDeleteBusy(false)
    }
  }
  async function cancelRecord(job: SyncView) {
    if (cancelLock.current) return
    cancelLock.current = true; setCancelBusy(true); setRecordError('')
    try {
      await cancelRepositorySync(job.syncId)
    } catch (failure) {
      setRecordError(failure instanceof Error ? failure.message : '取消分析失败，请刷新后重试')
    } finally {
      records.retry(); detail.retry()
      cancelLock.current = false; setCancelBusy(false)
    }
  }
  function analyzeBranch(branch: string) {
    setAnalysisSeed(previous => ({ key: (previous?.key ?? 0) + 1, form: { branch } }))
    navigate(repositoryRoute(repositoryId, 'analyses'))
  }
  function retryRecord(job: SyncView) {
    if (job.sourceKind === 'pr') return
    const usedExistingModel = job.requestedStrategy === 'generic-model' || job.modelStrategy === 'generic-model'
    const modelId = job.requestedModelId ?? job.modelId ?? (usedExistingModel ? job.resolvedModelId : null) ?? null
    setAnalysisSeed(previous => ({ key: (previous?.key ?? 0) + 1, form: { branch: job.branch, modelId } }))
  }
  async function openPRRecord(job: SyncView) {
    if (!job.sourceSnapshotId || openPRLock.current) return
    openPRLock.current = true; setOpeningPR(true)
    if (recordError !== '') setRecordError('')
    try {
      const source = await getPRSnapshot(job.sourceSnapshotId)
      if (source.repositoryId !== repositoryId) throw new Error('固定 PR 快照与当前项目不一致，未打开其他来源')
      navigate({ name: 'pr-work', repositoryId, owner: source.owner, repositoryName: source.name, number: source.number, snapshotId: source.snapshotId })
    } catch (failure) {
      setRecordError(failure instanceof Error ? failure.message : '读取原 PR 快照失败，请重试')
    } finally {
      openPRLock.current = false; setOpeningPR(false)
    }
  }

  const analysisViewNav = <nav aria-label="分析视图" className="flex gap-1 border-b border-border">
    {([{ value: 'analyses', label: '分析结果' }, { value: 'trends', label: '风险趋势' }]).map(option => {
      const active = (trendMode ? 'trends' : 'analyses') === option.value
      return <Button key={option.value} asChild variant="ghost" className={cn('rounded-none border-b-2', active ? 'border-primary' : 'border-transparent')}>
        <a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={active ? 'page' : undefined}>{option.label}</a>
      </Button>
    })}
  </nav>

  return <section className="grid gap-4">
    <header className="grid min-w-0 gap-2 rounded-xl border border-border-soft bg-card px-4 py-4 [overflow-wrap:anywhere] sm:px-5">
            <Button className="justify-self-start" aria-label="全部项目" variant="ghost" size="sm" onClick={() => navigate({ name: 'repositories' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}全部项目</Button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-sans text-2xl font-semibold leading-title tracking-tight text-foreground" title={repository.url}>{repository.displayName}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
              <a className="text-accent underline-offset-2 hover:underline" href={repository.url} target="_blank" rel="noreferrer">{repository.url.replace(/^https?:\/\/github\.com\//i, '')}</a>
              <span aria-hidden="true">·</span>
              <span>默认分支 {repository.defaultBranch ?? '未登记'}</span>
              {branchView && !activeJob ? <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5" role="status"><span className={cn('size-1.5 rounded-full', TONE_DOT[status.tone])} aria-hidden="true"/>{status.label}</span>
              </> : null}
            </div>
    </header>

    <nav aria-label="项目工作台视图" className="flex flex-wrap gap-1 rounded-xl border border-border-soft bg-card p-1 shadow-[var(--sh-1)]">{([{ value: 'overview', label: '概览' }, { value: 'analyses', label: '分支分析' }, { value: 'prs', label: 'PR 审查' }]).map(option => <Button key={option.value} asChild variant="ghost" className={cn('rounded-lg border-0 px-4', String(activeTab) === String(option.value) ? 'bg-accent-soft text-accent' : 'text-foreground-3 hover:bg-hover')}><a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={String(activeTab) === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>

    {activeTab === 'overview' ? <>
      <RepositoryOverviewView repositoryId={repositoryId} repository={repository} actions={<>
        <RepositoryUpdates repositoryId={repositoryId} onAnalyze={analyzeBranch} onUpdated={() => { detail.retry(); records.retry(); projectsChanged() }}/>
        <Button variant="ghost" size="sm" asChild><a {...linkTo({ name: 'my-data', view: 'builds', buildProjectId: repositoryId }, navigate)}>
          <Database aria-hidden="true" size={15}/>在我的数据中构建
        </a></Button>
      </>}/>
    </> : null}

    {branchView ? <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      {analysisViewNav}
      <AnalysisLauncher key={analysisSeed?.key ?? 'new'} initial={analysisSeed?.form} repositoryUrl={repository.url} defaultBranch={repository.defaultBranch}
        onClose={() => setAnalysisSeed(null)} onStarted={() => { records.retry(); detail.retry(); navigate(repositoryRoute(repositoryId, 'analyses')) }}/>
    </div>
    {activeJob ? <section className="rounded-md border border-border-soft bg-card p-card" aria-label="当前分析进度">
      <JobProgress status={activeJob.status} stage={activeJob.stage} queuePosition={activeJob.queuePosition} startedAt={activeJob.startedAt} scoresOnly={activeJob.requestedStrategy === 'generic-model'}/>
    </section> : null}
    {trendMode ? <ProjectTrends repositoryId={repositoryId} viewId={viewId} currentSyncId={context?.syncId} navigate={navigate}/> : <>
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className={cn('min-w-0', context && 'lg:relative lg:min-h-[24rem]')}>
        <ProjectAnalysisHistory records={records} currentNotice={currentNotice} recordError={recordError} stretch={Boolean(context)}>
          {records.syncs.map(job => <RecordRow key={job.syncId} job={job} current={job.syncId === context?.syncId} selecting={selectingId !== ''} onOpen={() => navigate(analysisRoute(repositoryId, job.syncId))} onCompare={context && job.status === 'completed' && job.syncId !== context.syncId ? () => navigate({ name: 'comparison', repositoryId, baseSyncId: job.syncId, targetSyncId: context.syncId }) : undefined} onSelect={() => void makeCurrent(job)} onDelete={() => setDeleteJob(job)} onDetail={() => setDetailJob(job)} onRetry={() => retryRecord(job)} onOpenPR={job.sourceKind === 'pr' && job.sourceSnapshotId ? () => void openPRRecord(job) : undefined} openingPR={openingPR} onCancel={() => setCancelJob(job)} deleteBusy={deleteBusy} cancelBusy={cancelBusy}/>) }
        </ProjectAnalysisHistory>
      </div>

      <div className="grid min-w-0 content-start gap-3">
        {context ? <AnalysisResultCard key={context.syncId} syncId={context.syncId} scope={scope} distribution={shownDistribution} activeView={activeView}
          historical={Boolean(latestCompletedId && context.syncId !== latestCompletedId)}
          notice={context.sourceKind === 'pr' ? '当前结果来自旧 PR 分析，不代表分支主线趋势。' : undefined}
          note={repository.degradeReason ? DEGRADE_LABELS[repository.degradeReason] ?? repository.degradeReason : undefined}
          viewSwitch={scope?.split ? <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="查看提交范围">
            <ToggleGroup type="single" value={String(activeView)} onValueChange={nextValue => { if (nextValue) (setScopeView)(nextValue as typeof activeView); }} aria-label="视图">{([
              { value: 'holdout', label: `留出 ${scope.split.holdout.count ?? 0}` },
              { value: 'test', label: `测试 ${scope.split.test.count ?? 0}` },
              { value: 'all', label: `全部 ${repository.commitCount}` },
            ]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
            <span className="text-foreground-3">{activeView === 'all' ? '含训练、验证、测试、留出与未纳入数据集的提交' : '模型没见过的提交'}</span>
          </div> : undefined}
          onOpenCommit={commitId => navigate(analysisRoute(repositoryId, context.syncId, { commitId }))}
          onOpenAll={() => navigate(analysisRoute(repositoryId, context.syncId))}
          onOpenDataset={() => setDatasetOpen(true)}/> : <div className="rounded-md border border-dashed border-border p-6 text-sm text-foreground-3">
          <p>还没有可用的分析结果。{latest?.status === 'failed' ? '最近一次分析失败，修正后重新发起。' : latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? '分析进行中，完成后这里会出现结果。' : '点击「分析分支提交」，选择要回查的分支。'}</p>
        </div>}
      </div>
    </div>
    </>}
    </> : null}

    {activeTab === 'prs' ? <ProjectPullRequests repositoryId={repositoryId} modelId={repository.modelId ?? undefined} batchModelId={context?.modelId ?? null} navigate={navigate}/> : null}

    <Dialog open={Boolean(detailJob)} onOpenChange={next => { if (!next) setDetailJob(null) }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${480}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"分析详情"}</DialogTitle></DialogHeader>{detailJob ? <RecordDetails job={detailJob} active={(ACTIVE_STATUSES as readonly string[]).includes(detailJob.status)}/> : null}</DialogContent></Dialog>
    <AlertDialog open={Boolean(deleteJob)} onOpenChange={next => { if (!next) setDeleteJob(null) }}><AlertDialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${460}px)`, maxWidth: 'none'}}><AlertDialogHeader><AlertDialogTitle>{"删除这条分析记录？"}</AlertDialogTitle><AlertDialogDescription>{deleteJob && deleteJob.syncId === context?.syncId ? '这是当前结果，删除后项目将暂时没有当前结果，其他成功记录仍可重新选择。此操作无法撤销。' : '这次分析与对应的提交结果将被删除。此操作无法撤销。'}</AlertDialogDescription></AlertDialogHeader>{null}<AlertDialogFooter>{<>
        <Button onClick={() => setDeleteJob(null)} variant="outline" type="button">取消</Button>
        <Button variant='destructive' onClick={() => { if (deleteJob) void removeRecord(deleteJob).then(() => setDeleteJob(null)) }} disabled={Boolean(deleteBusy)} type="button">{deleteBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认删除记录</Button>
      </>}</AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(cancelJob)} onOpenChange={next => { if (!next) setCancelJob(null) }}><AlertDialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${440}px)`, maxWidth: 'none'}}><AlertDialogHeader><AlertDialogTitle>{"取消这次分析？"}</AlertDialogTitle><AlertDialogDescription>{"取消后这次分析不再继续，已经生成的结果不会保留；可以用原参数重新发起。"}</AlertDialogDescription></AlertDialogHeader>{null}<AlertDialogFooter>{<>
        <Button onClick={() => setCancelJob(null)} variant="outline" type="button">返回</Button>
        <Button variant='destructive' onClick={() => { if (cancelJob) void cancelRecord(cancelJob).then(() => setCancelJob(null)) }} disabled={Boolean(cancelBusy)} type="button">{cancelBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认取消分析</Button>
      </>}</AlertDialogFooter></AlertDialogContent></AlertDialog>
    {context ? <ProjectDatasetDialog key={context.syncId} repositoryId={repositoryId} syncId={context.syncId}
      open={datasetOpen} onOpenChange={setDatasetOpen}/> : null}
  </section>
}
