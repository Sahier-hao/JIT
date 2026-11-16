import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { linkTo } from '@/app/navigation'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LoaderCircle, ArrowLeft, Database, ArrowRight, Pin, GitCompare, Check, Loader, AlertTriangle, MoreHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'


import { useEffect, useRef, useState } from 'react'





import { fetchRepositorySyncCommits, type SyncForm } from '@/lib/apiClient'
import { type SyncCommit, ACTIVE_STATUSES, DEGRADE_LABELS, PARTITION_LABELS, STATUS_LABELS, type SyncError, type SyncView } from '@/features/projects/repositoryContract'
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
import { getPRSnapshot } from '@/features/reviews/prReviewClient'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { analysisRoute, repositoryRoute, type Route } from '@/app/navigation'
import { cancelRepositorySync, deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '@/features/projects/projectClient'
import { projectStatus, type ProjectTone } from '@/features/projects/projectStatus'

import { useRepository } from '@/features/projects/repositoryWorkspace'
import { AnalysisScopeCard } from '@/features/projects/components/AnalysisScopeCard'
import { displayTime } from '@/lib/domain'
import { cn } from '@/lib/utils'

type ProjectTab = 'overview' | 'prs' | 'trends' | 'analyses'

const TONE_DOT: Record<ProjectTone, string> = { active: 'bg-blue', ok: 'bg-teal', alert: 'bg-rose', muted: 'bg-foreground-4' }
const PARTITION_CLASS: Record<string, string> = {
  holdout: 'bg-blue-soft text-blue-deep',
  test: 'bg-amber-soft text-amber-deep',
  validation: 'bg-teal-soft text-teal-deep',
  train: 'bg-soft text-foreground-3',
}

export function ProjectPage({ repositoryId, tab, viewId, navigate }: { repositoryId: string; tab?: ProjectTab; viewId?: string; navigate: (route: Route, replace?: boolean) => void }) {
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
  const priority = useAnalysisCommits(detail.repository?.viewContext?.syncId)

  if (detail.state === 'loading' && !detail.repository) return <LoadingNotice label="正在读取项目"/>
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
  const shownTotal = shownDistribution.high + shownDistribution.medium + shownDistribution.low + shownDistribution.unknown
  const shownShare = (count: number) => shownTotal ? Math.round((count / shownTotal) * 100) : 0
  const viewCommits = priority
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
    <header className="grid gap-4 border-b border-border-soft pb-4">
      <div className="grid gap-2">
        <Button className="justify-self-start" aria-label="全部项目" variant="ghost" size="sm" onClick={() => navigate({ name: 'repositories' })} type="button">{<ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}全部项目</Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-sans text-xl font-semibold leading-title text-foreground" title={repository.url}>{repository.displayName}</h1>
          <p className="inline-flex items-center gap-1.5 text-xs text-foreground-3" role="status"><span className={cn('size-1.5 rounded-full', TONE_DOT[status.tone])}/>{status.label}</p>
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
      {prAnalysisError ? <p className="text-xs text-rose" role="alert">{prAnalysisError}</p> : null}
    </header>

    {latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? <section className="rounded-md border border-border-soft bg-card p-card" aria-label="当前分析进度">
      <JobProgress status={latest.status} stage={latest.stage} queuePosition={latest.queuePosition} startedAt={latest.startedAt}/>
    </section> : null}

    <nav aria-label="项目工作台视图" className="flex gap-1 border-b border-border">{([{ value: 'overview', label: '概览' }, { value: 'analyses', label: '分析' }, { value: 'prs', label: 'PR 审查' }]).map(option => <Button key={option.value} asChild variant="ghost" className={`rounded-none border-b-2 ${String(activeTab) === String(option.value) ? 'border-primary' : 'border-transparent'}`}><a {...linkTo(repositoryRoute(repositoryId, option.value as 'overview' | 'analyses' | 'prs' | 'trends'), navigate)} aria-current={String(activeTab) === String(option.value) ? 'page' : undefined}>{option.label}</a></Button>)}</nav>

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

      <div className="grid content-start gap-3">
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

          <div className="grid gap-4 rounded-md border border-border-soft bg-card p-card sm:grid-cols-[160px_minmax(0,1fr)]">
            <div className="grid content-center gap-1">
              <b className="text-2xl font-semibold tabular-nums text-foreground">{shownTotal.toLocaleString()}</b>
              <span className="text-xs text-foreground-3">{activeView === 'holdout' ? '模型没见过的提交' : activeView === 'test' ? '测试集提交' : '已分析提交'}</span>
            </div>
            <div className="grid gap-2">
              <p className="text-xs text-foreground-3">模型分数分布（未校准）</p>
              <ul className="grid gap-1.5" aria-label={`模型分数分布：≥0.25 ${shownDistribution.high} 条、0.10 到 0.25 ${shownDistribution.medium} 条、小于 0.10 ${shownDistribution.low} 条`}>
                {([
                  ['≥ 0.25', shownDistribution.high, 'bg-rose'],
                  ['0.10–0.25', shownDistribution.medium, 'bg-amber'],
                  ['< 0.10', shownDistribution.low, 'bg-teal'],
                ] as const).map(([label, count, fill]) => <li key={label} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 tabular-nums text-foreground-3">{label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-strong"><span className={cn('block h-full rounded-full', fill)} style={{ width: `${shownShare(count)}%` }}/></span>
                  <span className="flex w-20 shrink-0 items-baseline justify-end gap-1 tabular-nums"><b className="text-foreground">{count.toLocaleString()}</b><em className="not-italic text-foreground-4">{shownShare(count)}%</em></span>
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

function RecordRow({ job, current, selecting, onOpen, onCompare, onSelect, onDelete, onDetail, onRetry, onOpenPR, openingPR, onCancel, deleteBusy, cancelBusy }: { job: SyncView; current: boolean; selecting: boolean; onOpen: () => void; onCompare?: () => void; onSelect: () => void; onDelete: () => void; onDetail: () => void; onRetry: () => void; onOpenPR?: () => void; openingPR: boolean; onCancel: () => void; deleteBusy: boolean; cancelBusy: boolean }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  const completed = job.status === 'completed'
  const isPR = job.sourceKind === 'pr'
  const pendingCancel = active && Boolean(job.cancelRequestedAt)
  const switchable = completed && !current && !isPR
  const title = pendingCancel ? '正在取消' : completed && current ? '当前结果' : switchable ? '设为当前结果' : job.status === 'queued' && job.queuePosition ? `排队第 ${job.queuePosition} 位` : STATUS_LABELS[active ? job.stage : job.status]
  const meta = `${shortTime(job.createdAt)} · ${syncSpan(job)}${switchable ? ' · 已完成' : ''}${isPR ? ' · PR 固定版本' : ''}`
  const shortId = job.syncId.slice(0, 7)
  const text = <div className="min-w-0">
    <p className="flex items-center gap-1.5 text-sm">
      {completed ? current ? <span className="text-accent" aria-label={`当前结果 ${shortId}`}><Pin aria-hidden="true" focusable="false"  size={12} fill="currentColor" strokeWidth={1.6}/></span>
        : isPR ? <span className="text-foreground-4"><GitCompare aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></span>
          : <span className="text-foreground-4"><Check aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></span>
        : <span className={cn(active ? 'text-accent' : 'text-rose')}>{active ? <Loader aria-hidden="true" focusable="false"  size={14}/> : <AlertTriangle aria-hidden="true" focusable="false" strokeWidth={1.5} size={14}/>}</span>}
      <span className="truncate font-medium text-foreground">{title}</span>
    </p>
    <p className="mt-0.5 text-xs text-foreground-3">{meta}{selecting && switchable ? ' · 正在切换…' : ''}</p>
  </div>
  return <article className={cn('rounded-sm border p-2.5', current ? 'border-accent bg-accent-soft/40' : 'border-border-soft bg-card')} data-current={current || undefined} aria-label={`分析记录 ${job.syncId}`}>
    <div className="flex items-start justify-between gap-2">
      {switchable ? <Button variant="ghost" type="button" className="min-w-0 flex-1 border-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" disabled={selecting} onClick={onSelect} aria-label={`将 ${shortId} 设为当前结果`}>{text}</Button> : text}
      <RecordMenu pendingCancel={pendingCancel} onOpen={isPR ? onOpenPR : completed ? onOpen : undefined} openLabel={isPR ? '查看原 PR 快照' : '打开结果'} openBusy={isPR ? openingPR : undefined} onCompare={onCompare} onRetry={!active && !completed && !isPR ? onRetry : undefined} onCancel={active && !pendingCancel ? onCancel : undefined} onDetail={onDetail} onSelect={completed && !current && !isPR ? onSelect : undefined} onDelete={!active ? onDelete : undefined} cancelBusy={cancelBusy} deleteBusy={deleteBusy}/>
    </div>
    {active ? <div className="mt-2"><JobProgress compact status={job.status} stage={job.stage} queuePosition={job.queuePosition} startedAt={job.startedAt}/></div> : null}
    {job.error ? <p className="mt-1.5 flex items-start gap-1 text-xs text-rose" title={job.error.message}><AlertTriangle aria-hidden="true" focusable="false" strokeWidth={1.5} size={13} className="mt-0.5 shrink-0"/>{failureText(job.error)}</p> : job.status === 'cancelled' ? <p className="mt-1.5 text-xs text-foreground-3">已取消，可用原参数重新分析。</p> : null}
  </article>
}

/** 记录详情：放进浮层，避免在列表里向下展开把卡片撑长。 */
function RecordDetails({ job, active }: { job: SyncView; active: boolean }) {
  return <dl className="grid gap-2 text-sm">
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2 first:border-t-0 first:pt-0"><dt className="text-xs text-foreground-3">范围</dt><dd className="m-0 break-words">{fullHistory(job.since) ? '全部历史' : `${job.since ?? '不限'} — ${job.until ?? '不限'}`}</dd></div>
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">分支</dt><dd className="m-0 break-words">{job.branch}</dd></div>
    {job.algorithmName ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">训练方法</dt><dd className="m-0 break-words">{job.algorithmName}</dd></div> : null}
    {job.startedAt ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">开始执行</dt><dd className="m-0 break-words">{displayTime(job.startedAt)}</dd></div> : null}
    {active && job.deadlineAt ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">执行截止</dt><dd className="m-0 break-words">{displayTime(job.deadlineAt)}</dd></div> : null}
    <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">数据</dt><dd className="m-0 break-words">{job.datasetVersion ?? '尚未生成'}</dd></div>
    {job.degradeReason ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">模型说明</dt><dd className="m-0 break-words">{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}
    {job.requestId ? <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 border-t border-border-soft pt-2"><dt className="text-xs text-foreground-3">请求标识</dt><dd className="m-0 break-all"><code className="font-mono text-xs">{job.requestId}</code></dd></div> : null}
  </dl>
}
function datasetRange(version?: string | null) {
  if (!version) return '未登记'
  // 同一区间重复采集时后端会在末尾追加短哈希，先剥掉再解析区间。
  const cleaned = version.replace(/-[0-9a-f]{6,}$/, '')
  const range = cleaned.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/)
  return range ? `${range[1]} → ${range[2].slice(5)}` : version
}
/** 记录卡只放一个入口：点开后再选具体动作，避免每行三四个图标。 */
function RecordMenu({ pendingCancel, onOpen, openLabel = '打开结果', openBusy, onCompare, onSelect, onRetry, onCancel, onDetail, onDelete, cancelBusy, deleteBusy }: {
  pendingCancel: boolean
  onOpen?: () => void
  openLabel?: string
  openBusy?: boolean
  onCompare?: () => void
  onSelect?: () => void
  onRetry?: () => void
  onCancel?: () => void
  onDetail: () => void
  onDelete?: () => void
  cancelBusy: boolean
  deleteBusy: boolean
}) {
  const items = [] as { key: string; label: string; danger?: boolean; disabled?: boolean }[]
  if (onOpen) items.push({ key: 'open', label: openLabel, disabled: openBusy })
  if (onCompare) items.push({ key: 'compare', label: '与当前结果对比' })
  if (onSelect) items.push({ key: 'select', label: '设为当前结果' })
  if (onRetry) items.push({ key: 'retry', label: '用这些参数重试' })
  if (onCancel) items.push({ key: 'cancel', label: '取消分析', disabled: cancelBusy })
  if (pendingCancel) items.push({ key: 'pending', label: '正在取消…', disabled: true })
  items.push({ key: 'detail', label: '分析详情' })
  if (onDelete) items.push({ key: 'delete', label: '删除记录', danger: true, disabled: deleteBusy })
  return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button aria-label="更多操作" title="更多操作" variant="ghost" size="icon-sm" type="button">{<MoreHorizontal aria-hidden="true" focusable="false" strokeWidth={1.5} size={16}/>}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{(items).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => {
    if (key === 'open') onOpen?.()
    else if (key === 'compare') onCompare?.()
    else if (key === 'select') onSelect?.()
    else if (key === 'retry') onRetry?.()
    else if (key === 'cancel') onCancel?.()
    else if (key === 'detail') onDetail()
    else if (key === 'delete') onDelete?.()
  })(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
}

/** 失败原因：常见错误给一句人话，原始信息留在详情里。 */
const FAILURE_TEXT: Record<string, string> = {
  DATASET_EXISTS: '同一数据版本已有不同内容，未覆盖；请重试，仍失败请联系维护者',
  REPOSITORY_UNAVAILABLE: '无法读取仓库，检查网络或地址后重试',
  REPOSITORY_CHECK_TIMEOUT: '检查远端仓库超时，可以重试',
  CONFLICT_ACTIVE_SYNC: '已有进行中的分析，结束后再试',
  DATASET_INVALID: '这个范围内没有可分析的提交，调整日期后重试',
  SYNC_TIMEOUT: '分析超过时限，可稍后重试',
  SYNC_INTERRUPTED: '服务停止时分析中断，可以重试',
  SYNC_CANCELLED: '这次分析已取消，可以重试',
}

function failureText(error: SyncError) {
  // DATASET_INVALID 的具体原因（如超过提交上限）由后端给出，优先显示，避免误报成"没有提交"。
  if (error.code === 'DATASET_INVALID' && error.message) return error.message
  return FAILURE_TEXT[error.code] ?? error.message
}
/** 记录的时间跨度：用采集区间，保持一行可读。 */
function syncSpan(job: SyncView) {
  if (fullHistory(job.since)) return '全部历史'
  return `${shortDay(job.since)} → ${shortDay(job.until)}`
}

/** 起点是 1970-01-01 表示未指定起点，即采集全部历史。 */
function fullHistory(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() <= 1970
}

function shortDay(value?: string | null) {
  if (!value) return '不限'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '不限'
}

/** 记录行的短时间戳：月-日 时:分，避免整行被截断。 */
function shortTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 读取本次分析最多 200 条提交，由页面按分区筛选后再取前三。 */
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
