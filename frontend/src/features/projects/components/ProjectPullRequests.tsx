import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { ArrowUpDown, ArrowUpRight, ChevronDown, LoaderCircle, RefreshCw, Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { useEffect, useRef, useState } from 'react'





import { EmptyState, FailureNotice, LoadingNotice } from '@/components/shared/Feedback'
import { Risk } from '@/components/shared/Risk'
import { displayTime } from '@/lib/domain'
import { repositoryModels, type ModelChoice } from '@/features/models/modelClient'
import { ModelSelect, usableModel } from '@/features/models/components/ModelSelect'
import { analyzeProjectPR, cancelProjectPRBatch, getTracking, latestProjectPRBatch, projectPRs, retryProjectPRBatch, type PRBatch, type PRState, type PRTracking, type ProjectPR, type ProjectPRPage } from '@/features/projects/projectActivityClient'
import { cacheKey, readCache, writeCache } from '@/lib/localCache'
import { readWorks, remoteStateLabels as remoteLabel, workKey } from '@/features/reviews/prReview'
import { useReviewAccount } from '@/features/reviews/reviewAccount'
import type { Route } from '@/app/navigation'
import { PRBatchLauncher } from '@/features/projects/components/PRBatchLauncher'
import { PRTrackingPanel } from '@/features/reviews/components/PRTrackingPanel'
import { ProgressBar } from '@/features/projects/components/JobProgress'
import { cn } from '@/lib/utils'

const analysisLabel: Record<string, string> = { checking: '检查中', unchanged: '版本未变', 'snapshot-ready': '快照就绪', queued: '排队中', running: '分析中', completed: '分析完成', failed: '分析失败', cancelled: '已取消', interrupted: '已中断', collecting: '采集中', registering: '登记中', training: '处理中', scoring: '评分中' }
const batchLabel: Record<string, string> = { discovering: '正在获取 PR 范围', running: '正在提交分析', completed: '提交完成', partial: '部分完成', failed: '未能开始', interrupted: '已中断', cancelled: '已取消' }
const ANALYSIS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'unscored', label: '未分析' },
  { value: 'running', label: '分析中' },
  { value: 'failed', label: '可重试' },
  { value: 'completed', label: '已分析' },
] as const
type AnalysisFilter = typeof ANALYSIS_FILTERS[number]['value']

function analysisGroup(status: string | null): Exclude<AnalysisFilter, 'all'> {
  if (status === 'completed') return 'completed'
  if (['queued', 'running', 'checking', 'collecting', 'registering', 'training', 'scoring'].includes(status ?? '')) return 'running'
  if (['failed', 'cancelled', 'interrupted'].includes(status ?? '')) return 'failed'
  return 'unscored'
}

export function ProjectPullRequests({ repositoryId, modelId, batchModelId = modelId, navigate }: {
  repositoryId: string
  modelId?: string
  batchModelId?: string | null
  navigate: (r: Route) => void
}) {
  const [state, setState] = useState<PRState>('open')
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'risk'>('updated')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const listKey = cacheKey('prs', repositoryId, state, page)
  const [loaded, setLoaded] = useState<{ key: string; value: ProjectPRPage } | null>(() => {
    const cached = readCache<ProjectPRPage>(listKey, 10 * 60_000)
    return cached ? { key: listKey, value: cached } : null
  })
  const result = loaded?.key === listKey ? loaded.value : null
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState<PRTracking | null>(null)
  const [trackingOpen, setTrackingOpen] = useState(false)
  const [batch, setBatch] = useState<PRBatch | null>(null)
  const [batchError, setBatchError] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [analyzingNumber, setAnalyzingNumber] = useState<number | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [reanalyzing, setReanalyzing] = useState<ProjectPR | null>(null)
  const [reanalyzeModel, setReanalyzeModel] = useState('')
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false)
  const [models, setModels] = useState<ModelChoice[]>([])
  const automatic = useRef(new Set<string>()), refreshRequested = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null)
    const cached = readCache<ProjectPRPage>(listKey, 10 * 60_000)
    if (cached) setLoaded(previous => previous?.key === listKey ? previous : { key: listKey, value: cached })
    const refresh = refreshRequested.current; refreshRequested.current = false
    async function load() {
      let value = await projectPRs(repositoryId, state, page, refresh, controller.signal)
      const key = `${repositoryId}:${state}:${page}`
      if (!refresh && value.supported && !value.checkedAt && !value.errorCode && !automatic.current.has(key)) { automatic.current.add(key); value = await projectPRs(repositoryId, state, page, true, controller.signal) }
      if (!controller.signal.aborted) {
        setLoaded({ key: listKey, value })
        if (value.supported && !value.errorCode) writeCache(listKey, value)
      }
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [repositoryId, state, page, listKey, attempt])
  useEffect(() => {
    const controller = new AbortController()
    getTracking(repositoryId, controller.signal).then(value => { if (!controller.signal.aborted) setTracking(value) }).catch(() => { if (!controller.signal.aborted) setTracking(null) })
    return () => controller.abort()
  }, [repositoryId, trackingOpen])
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(value => { if (!controller.signal.aborted) setModels(value) }).catch(() => {})
    return () => controller.abort()
  }, [])
  const batchActive = Boolean(batch && ['discovering', 'running'].includes(batch.status))
  const batchPolling = Boolean(batch && (batchActive || batch.counts.queued || batch.counts.running))
  useEffect(() => {
    const controller = new AbortController()
    latestProjectPRBatch(repositoryId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setBatch(value); setBatchError('') } })
      .catch(failure => { if (!controller.signal.aborted) setBatchError(failure instanceof Error ? failure.message : '批次进度读取失败') })
    return () => controller.abort()
  }, [repositoryId, attempt])
  async function retryItems(kind: 'failed' | 'interrupted') {
    if (!batch) return
    setBatchBusy(true); setBatchError('')
    try {
      const next = await retryProjectPRBatch(repositoryId, batch.batchId, kind)
      setBatch(next); setAttempt(value => value + 1)
    } catch (failure) {
      setBatchError(failure instanceof Error ? failure.message : '重试批次失败')
    } finally { setBatchBusy(false) }
  }
  async function cancelBatch() {
    if (!batch) return
    setCancelBusy(true); setBatchError('')
    try {
      const next = await cancelProjectPRBatch(repositoryId, batch.batchId)
      setBatch(next); setCancelOpen(false); setAttempt(value => value + 1)
    } catch (failure) {
      setBatchError(failure instanceof Error ? failure.message : '取消批次失败')
    } finally { setCancelBusy(false) }
  }
  function openReanalyze(pr: ProjectPR) {
    const candidates = models.filter(model => usableModel(model) && model.modelId !== pr.modelId)
    setReanalyzing(pr); setReanalyzeModel((candidates.find(model => model.isDefault) ?? candidates[0])?.modelId ?? '')
  }
  async function reanalyze() {
    if (!reanalyzing || !reanalyzeModel) return
    setReanalyzeBusy(true); setAnalysisError('')
    try {
      await analyzeProjectPR(repositoryId, reanalyzing.number, reanalyzeModel)
      setReanalyzing(null); setAttempt(value => value + 1)
    } catch (failure) {
      setAnalysisError(failure instanceof Error ? failure.message : `提交 #${reanalyzing.number} 重新分析失败`)
    } finally { setReanalyzeBusy(false) }
  }
  async function analyzeOne(pr: ProjectPR) {
    if (analyzingNumber !== null) return
    setAnalyzingNumber(pr.number); setAnalysisError('')
    try {
      const retry = analysisGroup(pr.analysisStatus) === 'failed'
      await analyzeProjectPR(repositoryId, pr.number, modelId, retry)
      setAttempt(value => value + 1)
    } catch (failure) {
      setAnalysisError(failure instanceof Error ? failure.message : `提交 #${pr.number} 分析失败`)
    } finally { setAnalyzingNumber(null) }
  }
  const modelName = (id?: string | null) => id ? (models.find(model => model.modelId === id)?.name ?? id.slice(0, 8)) : ''
  const reanalyzeCandidates = reanalyzing
    ? models.filter(model => usableModel(model) && model.modelId !== reanalyzing.modelId)
    : []
  const hasRunning = Boolean(result?.pullRequests.some(pr => analysisGroup(pr.analysisStatus) === 'running'))
  useEffect(() => {
    if (busy || (!hasRunning && !batchPolling)) return
    const timer = setTimeout(() => setAttempt(value => value + 1), 4000)
    return () => clearTimeout(timer)
  }, [busy, hasRunning, batchPolling, attempt])
  let localWorks: Set<string> = new Set()
  const { account } = useReviewAccount()
  try { localWorks = account ? new Set(readWorks(account).map(work => work.key)) : new Set() } catch { /* 本地存储损坏时仍允许查看远端 PR */ }
  const refresh = () => { refreshRequested.current = true; setAttempt(v => v + 1) }
  const rows = result ? (sortBy === 'risk' ? [...result.pullRequests].sort((a, b) => (b.maxRisk ?? -1) - (a.maxRisk ?? -1) || b.updatedAt.localeCompare(a.updatedAt)) : result.pullRequests) : []
  const summary = { all: rows.length, completed: 0, running: 0, failed: 0, unscored: 0 }
  for (const pr of rows) summary[analysisGroup(pr.analysisStatus)] += 1
  const visible = analysisFilter === 'all' ? rows : rows.filter(pr => analysisGroup(pr.analysisStatus) === analysisFilter)
  const privateRepository = result?.errorCode === 'PR_PRIVATE_REPOSITORY'
  const scopeLabel = state === 'open' ? '开放' : state === 'closed' ? '已结束' : '全部'
  return <section className="grid gap-4" aria-label="项目 PR 审查">
    <h2 className="sr-only">PR 审查</h2>
    {result?.supported === false
      ? <EmptyState title="此项目不是公开 GitHub 来源" description="PR 发现和自动分析只读取公开 GitHub；分支分析和风险趋势仍可使用。"/>
      : <>
        {error ? <FailureNotice error={error} onRetry={refresh}/> : null}
        {busy && !result ? <LoadingNotice label="正在读取项目 PR 清单"/> : null}
        {result ? <div className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card shadow-[var(--sh-1)]">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft px-4 py-4 sm:px-5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-base font-semibold">PR 列表</h2>
              <span className="rounded-full bg-soft px-2 py-0.5 text-xs text-foreground-3">{scopeLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {tracking?.supported === false ? null : <Button onClick={() => setTrackingOpen(true)} variant="ghost" size="sm" type="button" aria-label="PR 自动打分设置">
                <Settings2 aria-hidden="true" size={15}/>自动打分
                {tracking ? <span className={cn('rounded-full px-1.5 py-0.5 text-xs', tracking.enabled ? 'bg-accent-soft text-accent' : 'bg-soft text-foreground-3')}>{tracking.enabled ? '已开启' : '未开启'}</span> : null}
              </Button>}
              <Button variant="ghost" size="sm" disabled={busy} onClick={refresh} type="button" aria-label="刷新 PR 列表" title="只刷新远端 PR 列表，不拉取分支代码或运行模型">
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" size={15}/> : <RefreshCw aria-hidden="true" size={15}/>}刷新 PR 列表
              </Button>
              <PRBatchLauncher key={repositoryId} repositoryId={repositoryId} modelId={batchModelId ?? undefined} variant="default"
                openPage={state === 'open' ? page : undefined}
                onStarted={next => { setBatch(next); setBatchError(''); setAttempt(value => value + 1) }}/>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2 border-b border-border-soft bg-sunken/45 px-4 py-2.5 sm:px-5">
            <ToggleGroup type="single" size="sm" value={String(state)} onValueChange={nextValue => { if (nextValue) (value => { setState(value as PRState); setPage(1) })(nextValue as typeof state); }} aria-label="PR 范围">{([{ label: '开放', value: 'open' }, { label: '已结束', value: 'closed' }, { label: '全部', value: 'all' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
            <span aria-hidden="true" className="hidden h-5 w-px bg-border-soft sm:block"/>
            <label className="flex items-center gap-1.5 text-xs text-foreground-3 [&_[data-slot=native-select-wrapper]]:w-auto">
              分析状态
              <NativeSelect aria-label="本页分析状态" size="sm" value={analysisFilter} onChange={event => setAnalysisFilter(event.target.value as AnalysisFilter)}>
                {ANALYSIS_FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}（{summary[filter.value]}）</option>)}
              </NativeSelect>
            </label>
            <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-haspopup="menu" aria-label={`排序方式：${sortBy === 'updated' ? '按最近更新' : '按风险最高'}`} type="button"><ArrowUpDown aria-hidden="true" size={14}/>{sortBy === 'updated' ? '最近更新' : '风险最高'}<ChevronDown aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{([{ key: 'updated', label: '按最近更新' }, { key: 'risk', label: '按风险最高' }]).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => setSortBy(key as 'updated' | 'risk'))(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
          </div>

          {batch ? <div className="grid gap-2 border-b border-border-soft bg-sunken/30 px-4 py-3 sm:px-5">
            <ProgressBar value={batch.discovered ? Math.round(((batch.counts.completed + batch.counts.failed + batch.counts.cancelled + batch.counts.interrupted) / batch.discovered) * 100) : null}
              state={batch.status === 'failed' ? 'failed' : batch.status === 'completed' && batch.counts.completed + batch.counts.failed + batch.counts.cancelled + batch.counts.interrupted >= batch.discovered ? 'done' : batch.status === 'discovering' ? 'queued' : 'running'}
              label="批量分析进度"/>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-3">
              <span className={cn('font-medium', batch.status === 'failed' ? 'text-rose' : batch.status === 'completed' ? 'text-teal-deep' : 'text-foreground-2')}>批量分析 · {batchLabel[batch.status] ?? batch.status}</span>
              <span>{batch.discoveryComplete ? `范围 ${batch.discovered} 个开放 PR` : `已发现 ${batch.discovered} 个，范围未完整获取`}</span>
              <span>已入队 {batch.submission.submitted} · 复用 {batch.submission.reused} · 失败 {batch.counts.failed} · 待处理 {batch.submission.pending}</span>
              {batch.counts.cancelled || batch.counts.interrupted ? <span>取消/中断 {batch.counts.cancelled + batch.counts.interrupted}</span> : null}
              {batch.counts.queued || batch.counts.running ? <span>分析中 {batch.counts.queued + batch.counts.running}</span> : null}
              <span>模型 {modelName(batch.modelId)}</span>
              {batch.error ? <span role="alert" className="text-rose">{batch.error.message}</span> : null}
              {batchError ? <span role="alert" className="text-rose">{batchError}</span> : null}
              {batch.status !== 'cancelled' && (batch.status === 'discovering' || batch.status === 'running') ? <Button size="sm" disabled={batchBusy || cancelBusy || batch.cancelRequested} onClick={() => setCancelOpen(true)} variant="outline" type="button">{batch.cancelRequested || cancelBusy ? '正在取消…' : '取消批次'}</Button> : null}
              {batch.counts.failed > 0 && !batchActive ? <Button size="sm" disabled={batchBusy} onClick={() => void retryItems('failed')} variant="outline" type="button">{batchBusy ? '正在重试…' : '仅重试失败项'}</Button> : null}
              {batch.counts.interrupted > 0 && !batchActive ? <Button size="sm" disabled={batchBusy} onClick={() => void retryItems('interrupted')} variant="outline" type="button">{batchBusy ? '正在重试…' : '重新分析中断项'}</Button> : null}
            </div>
          </div> : null}
          {batchError && !batch ? <div className="border-b border-border-soft px-4 py-2 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert"><span>{batchError}</span><Button size="sm" onClick={() => setAttempt(value => value + 1)} variant="outline" type="button">重试读取</Button></div></div> : null}
          {result.errorCode ? <div className="border-b border-border-soft px-4 py-2 sm:px-5"><div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber-deep" role="alert"><span>{privateRepository ? '这是私有仓库，需要先关联有权限的 GitHub 账户后才能同步 PR。' : `远端检查未完成（${result.errorCode}）；以下是上次缓存，缺失条目不能认定为已关闭。`}</span><Button size="sm" disabled={busy && !privateRepository} onClick={privateRepository ? () => navigate({ name: 'profile' }) : refresh} variant="outline" type="button">{privateRepository ? '关联 GitHub' : '重试检查'}</Button></div></div> : null}
          {analysisError ? <div className="border-b border-border-soft px-4 py-2 sm:px-5"><div className="rounded-lg border border-rose/30 bg-rose-soft px-3 py-2 text-xs text-rose-deep" role="alert">{analysisError}</div></div> : null}
          {busy ? <div className="border-b border-border-soft px-4 py-2 sm:px-5"><ProgressBar value={null} state="queued" label="正在读取 PR 列表"/></div> : null}

          {visible.length ? <div className="divide-y divide-border-soft">
            {visible.map(pr => {
              const hasWork = Boolean(result.owner && result.name && localWorks.has(workKey(result.owner, result.name, pr.number)))
              const group = analysisGroup(pr.analysisStatus)
              const rowRunning = group === 'running'
              const rowLabel = analyzingNumber === pr.number ? '提交中…' : rowRunning ? '分析中…' : group === 'failed' ? '重试分析' : '分析'
              const statusText = pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'
              const statusTone = group === 'completed' ? 'bg-teal-soft text-teal-deep'
                : group === 'running' ? 'bg-accent-soft text-accent'
                  : group === 'failed' ? 'bg-rose-soft text-rose-deep' : 'bg-soft text-foreground-3'
              return <article key={pr.number} className="grid min-w-0 gap-3 px-4 py-4 transition-colors hover:bg-sunken/25 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]"><span className="font-mono text-xs text-foreground-3">#{pr.number}</span> {pr.title}</h3>
                    <span className={cn('rounded-sm px-1.5 py-0.5 text-xs', pr.remoteState === 'open' ? 'bg-teal-soft text-teal-deep' : 'bg-soft text-foreground-3')}>{remoteLabel[pr.remoteState]}</span>
                    {pr.draft ? <span className="rounded-sm bg-soft px-1.5 py-0.5 text-xs text-foreground-3">草稿</span> : null}
                    <span className={cn('rounded-sm px-1.5 py-0.5 text-xs', statusTone)}>{statusText}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-3">
                    <span>{pr.author}</span>
                    <span>更新于 {displayTime(pr.updatedAt)}</span>
                    {pr.modelId ? <span>{modelName(pr.modelId)}</span> : null}
                    {pr.featureSource ? <span>复用已保存特征</span> : null}
                    {pr.maxRisk != null ? <div className="flex items-center gap-1.5 text-foreground-2" title="该 PR 已分析提交中的最高分数；排序参考，不是 PR 整体缺陷概率">
                      <span className="whitespace-nowrap">最高风险</span>
                      <Risk risk={pr.maxRisk}/>
                      {pr.scoredCommits != null ? <span className="whitespace-nowrap text-foreground-4">{pr.scoredCommits} 条有分数</span> : null}
                    </div> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:self-start">
                  {result.owner && result.name ? <>
                    {pr.analysisStatus !== 'completed'
                      ? <Button size="sm" variant="ghost" disabled={rowRunning || analyzingNumber !== null} onClick={() => void analyzeOne(pr)} type="button">{rowLabel}</Button>
                      : <Button size="sm" variant="ghost" disabled={analyzingNumber !== null} onClick={() => openReanalyze(pr)} type="button">换模型</Button>}
                    <Button size="sm" variant="link" className="gap-1 px-1 text-sm text-accent" onClick={() => navigate({ name: 'pr-work', repositoryId, owner: result.owner!, repositoryName: result.name!, number: pr.number })} type="button">{hasWork ? '继续审查' : '查看 PR'}<ArrowUpRight aria-hidden="true" size={14}/></Button>
                  </> : <a className="text-xs text-accent underline-offset-2 hover:underline" href={pr.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>}
                </div>
              </article>
            })}
          </div> : <p className="px-4 py-10 text-center text-sm text-foreground-3 sm:px-5">{rows.length ? '本页没有符合分析状态的 PR' : '当前范围没有 PR'}</p>}

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft px-4 py-3 text-xs text-foreground-3 sm:px-5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{result.checkedAt ? `同步于 ${displayTime(result.checkedAt)}` : '尚未同步远端'}</span>
              <span role="status">{analysisFilter === 'all' ? `本页 ${rows.length} 个` : `本页显示 ${visible.length} / ${rows.length} 个`}</span>
            </span>
            {page > 1 || result.hasMore ? <nav className="flex items-center gap-2" aria-label="PR 分页"><Button size="sm" disabled={busy || page <= 1} onClick={() => setPage(v => v - 1)} variant="outline" type="button">上一页</Button><span>第 {page} 页</span><Button size="sm" disabled={busy || !result.hasMore} onClick={() => setPage(v => v + 1)} variant="outline" type="button">下一页</Button></nav> : null}
          </footer>
        </div> : null}
      </>}

    <Dialog open={trackingOpen} onOpenChange={setTrackingOpen}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${620}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>PR 自动打分设置</DialogTitle></DialogHeader><PRTrackingPanel repositoryId={repositoryId} onTracking={setTracking}/></DialogContent></Dialog>
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${440}px)`, maxWidth: 'none'}}><AlertDialogHeader><AlertDialogTitle>{"取消这次批量分析？"}</AlertDialogTitle><AlertDialogDescription>{"将停止提交后续条目；已入队的单 PR 任务继续执行并保留结果。"}</AlertDialogDescription></AlertDialogHeader><div className="flex justify-end gap-2">
        <Button onClick={() => setCancelOpen(false)} variant="outline" type="button">返回</Button>
        <Button variant='destructive' onClick={() => void cancelBatch()} disabled={Boolean(cancelBusy)} type="button">{cancelBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认取消</Button>
      </div></AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(reanalyzing)} onOpenChange={next => { if (!next) setReanalyzing(null) }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${480}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{reanalyzing ? `换模型分析 #${reanalyzing.number}` : '换模型分析'}</DialogTitle></DialogHeader>{reanalyzeCandidates.length
        ? <ModelSelect models={reanalyzeCandidates} value={reanalyzeModel} onValueChange={setReanalyzeModel} label="重新分析模型"/>
        : <p className="text-xs text-foreground-3">没有其他可用的兼容模型</p>}<DialogFooter>{<><Button onClick={() => setReanalyzing(null)} variant="outline" type="button">取消</Button><Button variant='default' disabled={Boolean(!reanalyzeModel) || Boolean(reanalyzeBusy)} onClick={() => void reanalyze()} type="button">{reanalyzeBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}开始分析</Button></>}</DialogFooter></DialogContent></Dialog>
  </section>
}
