import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { linkTo } from '@/app/navigation'

import { Button } from '@/components/ui/button'
import { LoaderCircle, ArrowLeft, Database, ArrowRight } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'


import { useEffect, useRef, useState } from 'react'





import { type SyncForm } from '@/lib/apiClient'
import { ACTIVE_STATUSES, DEGRADE_LABELS, type SyncView } from '@/features/projects/repositoryContract'
import { prBatchChanged, projectsChanged } from '@/features/projects/projectEvents'
import { repositoryModels, useModelName, type ModelChoice } from '@/features/models/modelClient'
import { analyzeAllProjectPRs, projectPROpenCount, type PRBatchScope } from '@/features/projects/projectActivityClient'
import { AnalysisLauncher } from '@/features/projects/components/AnalysisLauncher'
import { RepositoryUpdates } from '@/features/projects/components/RepositoryUpdates'
import { RepositoryOverviewView } from '@/features/projects/components/RepositoryOverview'
import { ProjectPullRequests } from '@/features/projects/components/ProjectPullRequests'
import { ProjectAnalysisHistory } from '@/features/projects/components/ProjectAnalysisHistory'
import { JobProgress } from '@/features/projects/components/JobProgress'
import { ProjectTrends } from '@/features/projects/components/ProjectTrends'
import { ProjectDatasetDialog } from '@/features/projects/components/ProjectDatasetDialog'
import { DatasetBuildDialog } from '@/features/projects/components/DatasetBuildDialog'
import { PriorityCommits } from '@/features/projects/components/PriorityCommits'
import { RecordDetails, RecordRow, datasetRange } from '@/features/projects/components/AnalysisRecords'
import { getPRSnapshot } from '@/features/reviews/prReviewClient'
import { EmptyState } from '@/components/shared/Feedback'
import { ProjectPageSkeleton } from '@/components/shared/Skeletons'
import { analysisRoute, repositoryRoute, type Route } from '@/app/navigation'
import { cancelRepositorySync, deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '@/features/projects/projectClient'
import { projectStatus, type ProjectTone } from '@/features/projects/projectStatus'

import { useRepository } from '@/features/projects/repositoryWorkspace'
import { AnalysisScopeCard } from '@/features/projects/components/AnalysisScopeCard'
import { displayTime } from '@/lib/domain'
import { cn } from '@/lib/utils'

type ProjectTab = 'overview' | 'prs' | 'trends' | 'analyses'

const TONE_DOT: Record<ProjectTone, string> = { active: 'bg-blue', ok: 'bg-teal', alert: 'bg-rose', muted: 'bg-foreground-4' }

export function ProjectPage({ repositoryId, tab, viewId, buildTaskId, navigate }: { repositoryId: string; tab?: ProjectTab; viewId?: string; buildTaskId?: string; navigate: (route: Route, replace?: boolean) => void }) {
  // 风险趋势不再是独立页签：地址仍保留 /trends[/viewId] 以支持旧链接，界面并入「分析」。
  const trendMode = tab === 'trends'
  const activeTab = trendMode ? 'analyses' : tab ?? 'overview'
  const detail = useRepository(repositoryId)
  const modelName = useModelName(detail.repository?.modelId)
  const [prAnalyzing, setPrAnalyzing] = useState(false)
  const [prAnalysisError, setPrAnalysisError] = useState('')
  const [prDialog, setPrDialog] = useState(false)
  const [modelChoices, setModelChoices] = useState<ModelChoice[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [prScopeKind, setPrScopeKind] = useState<'all' | 'limit' | 'page'>('all')
  const [prScopeLimit, setPrScopeLimit] = useState('50')
  const [prOpenCount, setPrOpenCount] = useState<number | null>(null)
  const [prPage, setPrPage] = useState(1)
  async function openPrAnalysis() {
    setPrAnalysisError('')
    try {
      const [list, openCount] = await Promise.all([
        repositoryModels(),
        projectPROpenCount(repositoryId).catch(() => null),
      ])
      setPrOpenCount(openCount)
      const usable = list.filter(model => model.state === 'ready' && model.enabled && model.repositoryPredictionSupported)
      setModelChoices(usable)
      const current = usable.find(model => model.modelId === detail.repository?.viewContext?.modelId)
      setSelectedModel(current?.modelId ?? usable.find(model => model.isDefault)?.modelId ?? usable[0]?.modelId ?? '')
      setPrDialog(true)
    } catch (failure) {
      setPrAnalysisError(failure instanceof Error ? failure.message : '读取模型失败')
    }
  }
  const prScope: PRBatchScope = prScopeKind === 'all' ? { kind: 'all' }
    : prScopeKind === 'limit' ? { kind: 'limit', limit: Number(prScopeLimit) }
    : { kind: 'page', page: prPage }
  const prScopeValid = prScopeKind !== 'limit' || (Number.isInteger(Number(prScopeLimit)) && Number(prScopeLimit) >= 1 && Number(prScopeLimit) <= 500)
  async function analyzeAllPRs() {
    setPrAnalyzing(true); setPrAnalysisError('')
    try {
      await analyzeAllProjectPRs(repositoryId, selectedModel || undefined, prScope)
      setPrDialog(false)
      prBatchChanged()
      navigate(repositoryRoute(repositoryId, 'prs'))
    } catch (failure) {
      setPrAnalysisError(failure instanceof Error ? failure.message : '提交 PR 分析失败')
    } finally { setPrAnalyzing(false) }
  }
  const [page, setPage] = useState(0)
  const records = useRepositorySyncs(repositoryId, 10, page * 10)
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
  const [retryDraft, setRetryDraft] = useState<{ key: number; form: Partial<SyncForm> } | null>(null)
  const [analysisSeed, setAnalysisSeed] = useState<{ key: number; form: Partial<SyncForm> } | null>(null)
  const [openingPR, setOpeningPR] = useState(false)
  const [datasetOpen, setDatasetOpen] = useState(false)
  const [datasetBuildOpen, setDatasetBuildOpen] = useState(false)
  useEffect(() => { if (buildTaskId) setDatasetBuildOpen(true) }, [buildTaskId])
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
  useEffect(() => { if (records.state === 'ready' && page > 0 && page * 10 >= records.total) setPage(Math.max(0, Math.ceil(records.total / 10) - 1)) }, [records.state, records.total, page])

  if (detail.state === 'loading' && !detail.repository) return <ProjectPageSkeleton/>
  if (detail.state === 'error' || !detail.repository) {
    return <EmptyState title="项目读取失败" description={detail.error} tone="alert"><Button onClick={detail.retry} variant="outline" type="button">重新加载</Button><Button onClick={() => navigate({ name: 'repositories' })} variant="outline" type="button">返回项目列表</Button></EmptyState>
  }

  const repository = detail.repository
  const latest = records.syncs[0] ?? repository.latestSync
  const status = projectStatus(repository, latest)
  const context = repository.viewContext
  const scope = context?.scope ?? null
  const activeView = scope?.split ? scopeView : 'all'
  const shownDistribution = scope?.distributions[activeView] ?? repository.distribution
  const latestCompletedId = records.syncs.find(job => job.status === 'completed')?.syncId ?? null
  const currentBatchModel = modelChoices.find(model => model.modelId === repository.viewContext?.modelId)
  const defaultBatchModel = modelChoices.find(model => model.isDefault)
  const prModelOptions = [
    ...(currentBatchModel ? [{ value: currentBatchModel.modelId, label: `当前项目模型 · ${currentBatchModel.name}` }] : []),
    ...(defaultBatchModel && defaultBatchModel.modelId !== currentBatchModel?.modelId ? [{ value: defaultBatchModel.modelId, label: `默认模型 · ${defaultBatchModel.name}` }] : []),
    ...modelChoices.filter(model => model.modelId !== currentBatchModel?.modelId && model.modelId !== defaultBatchModel?.modelId).map(model => ({ value: model.modelId, label: model.name })),
  ]

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
    setRetryDraft(null)
    setAnalysisSeed(previous => ({ key: (previous?.key ?? 0) + 1, form: { branch } }))
  }
  function retryRecord(job: SyncView) {
    if (job.sourceKind === 'pr') return
    setRetryDraft(previous => ({ key: (previous?.key ?? 0) + 1, form: {
      repositoryUrl: repository.url,
      branch: job.branch,
      strategy: job.requestedStrategy,
      algorithm: job.algorithm ?? undefined,
      splitPreset: job.splitPreset ?? undefined,
      maturityPolicy: job.maturityPolicy === 'include-immature'
        ? 'include-immature' : 'mature-only',
      modelId: job.requestedModelId ?? (job.requestedStrategy === 'generic-model' || job.modelStrategy === 'generic-model' ? job.resolvedModelId : '') ?? '',
    } }))
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

  return <section className="grid gap-4">
    <header className="relative overflow-hidden rounded-2xl border border-border-soft bg-card px-5 py-5 shadow-[var(--sh-2)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_46%)] opacity-80" aria-hidden="true"/>
      <div className="relative grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-2">
            <Button className="justify-self-start" aria-label="全部项目" variant="ghost" size="sm" onClick={() => navigate({ name: 'repositories' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}全部项目</Button>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-sans text-2xl font-semibold leading-title tracking-tight text-foreground" title={repository.url}>{repository.displayName}</h1>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-card/80 px-2.5 py-1 text-xs text-foreground-3" role="status"><span className={cn('size-1.5 rounded-full', TONE_DOT[status.tone])}/>{status.label}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-3">
              <a className="text-accent underline-offset-2 hover:underline" href={repository.url} target="_blank" rel="noreferrer">{repository.url.replace(/^https?:\/\/github\.com\//i, '')}</a>
              <span aria-hidden="true">·</span>
              <span>默认分支 {repository.defaultBranch ?? '未登记'}</span>
              <span aria-hidden="true">·</span>
              <RepositoryUpdates key={repositoryId} repositoryId={repositoryId} onAnalyze={branch => analyzeBranch(branch)} onUpdated={() => { detail.retry(); records.retry(); projectsChanged() }}/>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setDatasetBuildOpen(true)} variant="outline" type="button">{<Database aria-hidden="true" focusable="false" strokeWidth={1.5} size={15}/>}构建数据集</Button>
            <Button onClick={() => void openPrAnalysis()} variant="outline" type="button">分析全部 PR</Button>
            <AnalysisLauncher key={retryDraft?.key ?? analysisSeed?.key ?? 'new'} initial={retryDraft?.form ?? analysisSeed?.form} repositoryUrl={repository.url} defaultBranch={repository.defaultBranch} onStarted={() => { setPage(0); records.retry(); detail.retry(); navigate(repositoryRoute(repositoryId, 'analyses')) }}/>
          </div>
        </div>
        {prAnalysisError ? <p className="text-xs text-rose" role="alert">{prAnalysisError}</p> : null}
      </div>
    </header>

    {latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? <section className="rounded-md border border-border-soft bg-card p-card" aria-label="当前分析进度">
      <JobProgress status={latest.status} stage={latest.stage} queuePosition={latest.queuePosition} startedAt={latest.startedAt}/>
    </section> : null}

    <nav aria-label="项目工作台视图" className="flex gap-1 rounded-xl border border-border-soft bg-card p-1 shadow-[var(--sh-1)]">{([{ value: 'overview', label: '概览' }, { value: 'analyses', label: '分析' }, { value: 'prs', label: 'PR 审查' }]).map(option => <Button key={option.value} asChild variant="ghost" className={cn('rounded-lg border-0 px-4', String(activeTab) === String(option.value) ? 'bg-accent-soft text-accent' : 'text-foreground-3 hover:bg-hover')}><a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={String(activeTab) === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>

    {activeTab === 'overview' ? <>
      <RepositoryOverviewView repositoryId={repositoryId} repository={repository} onOpenAnalysis={() => navigate(repositoryRoute(repositoryId, 'analyses'))}/>
    </> : null}

    {activeTab === 'analyses' ? <>
    {trendMode ? <ProjectTrends repositoryId={repositoryId} viewId={viewId} currentSyncId={context?.syncId} navigate={navigate} switchSlot={
      <nav aria-label="分析视图" className="flex gap-1 border-b border-border">{([{ value: 'analyses', label: '分析结果' }, { value: 'trends', label: '风险趋势' }]).map(option => <Button key={option.value} asChild variant="ghost" className={`rounded-none border-b-2 ${String("trends") === String(option.value) ? 'border-primary' : 'border-transparent'}`}><a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={String("trends") === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>
    }/> : <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium text-foreground-2">当前结果</span>
      <nav aria-label="分析视图" className="flex gap-1 border-b border-border">{([{ value: 'analyses', label: '分析结果' }, { value: 'trends', label: '风险趋势' }]).map(option => <Button key={option.value} asChild variant="ghost" className={`rounded-none border-b-2 ${String("analyses") === String(option.value) ? 'border-primary' : 'border-transparent'}`}><a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={String("analyses") === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>
    </div>
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <ProjectAnalysisHistory records={records} currentNotice={currentNotice} recordError={recordError} page={page} setPage={setPage}>
        {records.syncs.map(job => <RecordRow key={job.syncId} job={job} current={job.syncId === context?.syncId} selecting={selectingId !== ''} onOpen={() => navigate(analysisRoute(repositoryId, job.syncId))} onCompare={context && job.status === 'completed' && job.syncId !== context.syncId ? () => navigate({ name: 'comparison', repositoryId, baseSyncId: job.syncId, targetSyncId: context.syncId }) : undefined} onSelect={() => void makeCurrent(job)} onDelete={() => setDeleteJob(job)} onDetail={() => setDetailJob(job)} onRetry={() => retryRecord(job)} onOpenPR={job.sourceKind === 'pr' && job.sourceSnapshotId ? () => void openPRRecord(job) : undefined} openingPR={openingPR} onCancel={() => setCancelJob(job)} deleteBusy={deleteBusy} cancelBusy={cancelBusy}/>) }
      </ProjectAnalysisHistory>

      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">当前分析结果{context && latestCompletedId && context.syncId !== latestCompletedId ? <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] font-normal text-foreground-3">历史固定结果</span> : null}</h2>
          <span className="text-xs text-foreground-3">{context ? [context.completedAt ? displayTime(context.completedAt) : '', modelName ?? ''].filter(Boolean).join(' · ') : ''}</span>
        </div>
        {context && context.sourceKind === 'pr' ? <p className="text-xs text-foreground-3">当前结果来自旧 PR 分析，不代表分支主线趋势。</p> : null}
        {context ? <div className="grid gap-3">
          {scope ? <AnalysisScopeCard scope={scope} onOpenDataset={() => setDatasetOpen(true)}/> : null}
          {scope?.split ? <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="查看提交范围">
            <ToggleGroup type="single" value={String(activeView)} onValueChange={nextValue => { if (nextValue) (setScopeView)(nextValue as typeof activeView); }} aria-label="视图">{([
              { value: 'holdout', label: `留出 ${scope.split.holdout.count ?? 0}` },
              { value: 'test', label: `测试 ${scope.split.test.count ?? 0}` },
              { value: 'all', label: `全部 ${repository.commitCount}` },
            ]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
            <span className="text-foreground-3">{activeView === 'all' ? '含训练、验证、测试、留出与未纳入数据集的提交' : '模型没见过的提交'}</span>
          </div> : null}

          <PriorityCommits syncId={context.syncId} scope={scope} distribution={shownDistribution} activeView={activeView}/>

          <div className="grid gap-3">
            {repository.degradeReason ? <p className="text-xs text-foreground-3">模型说明：{DEGRADE_LABELS[repository.degradeReason] ?? repository.degradeReason}</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-sm border border-border-soft px-2 py-1 text-xs text-foreground-3" title={context.datasetVersion ?? ''}>数据 <b className="text-foreground">{datasetRange(context.datasetVersion)}</b></span>
                <Button variant="ghost" size="sm" onClick={() => setDatasetOpen(true)} type="button">数据来源</Button>
              </div>
              <Button variant='default' aria-label="查看提交明细" onClick={() => navigate(analysisRoute(repositoryId, context.syncId))} type="button">查看提交明细{<ArrowRight aria-hidden="true" focusable="false" strokeWidth={1.5} size={15}/>}</Button>
            </div>
          </div>
        </div> : <div className="rounded-md border border-dashed border-border p-6 text-sm text-foreground-3">
          <p>还没有可用的分析结果。{latest?.status === 'failed' ? '最近一次分析失败，修正后重新发起。' : latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? '分析进行中，完成后这里会出现结果。' : ''}</p>
        </div>}
      </div>
    </div>
    </>}
    </> : null}

    {activeTab === 'prs' ? <ProjectPullRequests repositoryId={repositoryId} modelId={repository.modelId ?? undefined} onPageChange={setPrPage} navigate={navigate}/> : null}

    <Dialog open={prDialog} onOpenChange={setPrDialog}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${520}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"分析全部 PR"}</DialogTitle></DialogHeader><div className="grid gap-3">
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">模型</span>
          <Select value={selectedModel == null ? '' : String(selectedModel)} onValueChange={nextValue => (setSelectedModel)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="批量分析模型"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(prModelOptions).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
        </label>
        <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">范围</span>
          <Select value={prScopeKind == null ? '' : String(prScopeKind)} onValueChange={nextValue => (value => setPrScopeKind(value as 'all' | 'limit' | 'page'))(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="批量分析范围"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([
            { value: 'all', label: '全部开放 PR' },
            { value: 'limit', label: '前 N 个' },
            { value: 'page', label: `当前页（第 ${prPage} 页）` },
          ]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
        </label>
        {prScopeKind === 'limit' ? <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">数量</span>
          <Input aria-label="批量分析数量" min={1} max={500} value={prScopeLimit} onChange={event => setPrScopeLimit(event.target.value)} type="number"/>
        </label> : null}
        <p className="text-xs text-foreground-3">开放 PR <b className="text-foreground">{prOpenCount == null ? '—' : prOpenCount}</b> 个</p>
      </div><DialogFooter>{<><Button onClick={() => setPrDialog(false)} variant="outline" type="button">取消</Button><Button variant='default' disabled={Boolean(!selectedModel || !prScopeValid) || Boolean(prAnalyzing)} onClick={() => void analyzeAllPRs()} type="button">{prAnalyzing ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}开始分析</Button></>}</DialogFooter></DialogContent></Dialog>
    <DatasetBuildDialog
      repositoryId={repositoryId}
      defaultBranch={repository.defaultBranch}
      initialTaskId={buildTaskId}
      open={datasetBuildOpen}
      onOpenChange={setDatasetBuildOpen}
      navigate={navigate}
    />
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
