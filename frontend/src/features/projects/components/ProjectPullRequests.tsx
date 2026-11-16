import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { LoaderCircle, ChevronDown } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { useEffect, useRef, useState } from 'react'





import { EmptyState, FailureNotice, LoadingNotice } from '@/components/shared/Feedback'
import { displayTime } from '@/lib/domain'
import { repositoryModels, type ModelChoice } from '@/features/models/modelClient'
import { analyzeProjectPR, cancelProjectPRBatch, getTracking, latestProjectPRBatch, projectPRs, retryProjectPRBatch, type PRBatch, type PRState, type PRTracking, type ProjectPR, type ProjectPRPage } from '@/features/projects/projectActivityClient'
import { cacheKey, readCache, writeCache } from '@/lib/localCache'
import { readWorks, remoteStateLabels as remoteLabel, workKey } from '@/features/reviews/prReview'
import { useReviewAccount } from '@/features/reviews/reviewAccount'
import type { Route } from '@/app/navigation'
import { PR_BATCH_CHANGED } from '@/features/projects/projectEvents'
import { PRTrackingPanel } from '@/features/reviews/components/PRTrackingPanel'
import { ProgressBar } from '@/features/projects/components/JobProgress'
import { cn } from '@/lib/utils'

const analysisLabel: Record<string, string> = { checking: '检查中', unchanged: '版本未变', 'snapshot-ready': '快照就绪', queued: '排队中', running: '分析中', completed: '分析完成', failed: '分析失败', cancelled: '已取消', interrupted: '已中断', collecting: '采集中', scoring: '评分中' }
const batchLabel: Record<string, string> = { discovering: '正在获取 PR 范围', running: '正在提交分析', completed: '提交完成', partial: '部分完成', failed: '未能开始', interrupted: '已中断', cancelled: '已取消' }

/** 项目 PR 审查：只负责发现、筛选与打开 PR；后台自动分析在工具栏的「自动分析」里配置。 */
export function ProjectPullRequests({ repositoryId, modelId, onPageChange, navigate }: { repositoryId: string; modelId?: string; onPageChange?: (page: number) => void; navigate: (r: Route) => void }) {
  const [state, setState] = useState<PRState>('open')
  const [sortBy, setSortBy] = useState<'updated' | 'risk'>('updated')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ProjectPRPage | null>(() => readCache(cacheKey('prs', repositoryId, 'open', 1), 10 * 60_000))
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
  useEffect(() => { onPageChange?.(page) }, [page, onPageChange])
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(null)
    const cache = cacheKey('prs', repositoryId, state, page)
    const cached = readCache<ProjectPRPage>(cache, 10 * 60_000)
    if (cached) setResult(cached)
    const refresh = refreshRequested.current; refreshRequested.current = false
    async function load() {
      let value = await projectPRs(repositoryId, state, page, refresh, controller.signal)
      const key = `${repositoryId}:${state}:${page}`
      if (!refresh && value.supported && !value.checkedAt && !value.errorCode && !automatic.current.has(key)) { automatic.current.add(key); value = await projectPRs(repositoryId, state, page, true, controller.signal) }
      if (!controller.signal.aborted) { setResult(value); if (value.supported && !value.errorCode) writeCache(cache, value) }
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(e) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [repositoryId, state, page, attempt])
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
  useEffect(() => {
    if (!batchPolling) return
    const timer = setInterval(() => setAttempt(value => value + 1), 4000)
    return () => clearInterval(timer)
  }, [batchPolling])
  useEffect(() => {
    const bump = () => setAttempt(value => value + 1)
    window.addEventListener(PR_BATCH_CHANGED, bump)
    return () => window.removeEventListener(PR_BATCH_CHANGED, bump)
  }, [])
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
    const candidates = models.filter(model => model.state === 'ready' && model.enabled && model.repositoryPredictionSupported && model.modelId !== pr.modelId)
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
      const retry = ['failed', 'cancelled', 'interrupted'].includes(pr.analysisStatus ?? '')
      await analyzeProjectPR(repositoryId, pr.number, modelId, retry)
      setAttempt(value => value + 1)
    } catch (failure) {
      setAnalysisError(failure instanceof Error ? failure.message : `提交 #${pr.number} 分析失败`)
    } finally { setAnalyzingNumber(null) }
  }
  const modelName = (id?: string | null) => id ? (models.find(model => model.modelId === id)?.name ?? id.slice(0, 8)) : ''
  const reanalyzeOptions = reanalyzing
    ? models.filter(model => model.state === 'ready' && model.enabled && model.repositoryPredictionSupported && model.modelId !== reanalyzing.modelId)
      .map(model => ({ value: model.modelId, label: model.name }))
    : []
  const hasRunning = Boolean(result?.pullRequests.some(pr => ['queued', 'running', 'checking', 'collecting'].includes(pr.analysisStatus ?? '')))
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => setAttempt(value => value + 1), 4000)
    return () => clearInterval(timer)
  }, [hasRunning])
  let localWorks: Set<string> = new Set()
  const { account } = useReviewAccount()
  try { localWorks = account ? new Set(readWorks(account).map(work => work.key)) : new Set() } catch { /* 本地存储损坏时仍允许查看远端 PR */ }
  const refresh = () => { refreshRequested.current = true; setAttempt(v => v + 1) }
  const rows = result ? (sortBy === 'risk' ? [...result.pullRequests].sort((a, b) => (b.maxRisk ?? -1) - (a.maxRisk ?? -1) || b.updatedAt.localeCompare(a.updatedAt)) : result.pullRequests) : []
  const summary = rows.reduce((acc, pr) => {
    if (pr.analysisStatus === 'completed') acc.completed += 1
    else if (['queued', 'running', 'checking'].includes(pr.analysisStatus ?? '')) acc.running += 1
    else if (['failed', 'cancelled', 'interrupted'].includes(pr.analysisStatus ?? '')) acc.failed += 1
    else acc.none += 1
    return acc
  }, { completed: 0, running: 0, failed: 0, none: 0 })
  const statusRank = (status?: string | null) => ['running', 'queued', 'checking'].includes(status ?? '') ? 0 : ['failed', 'cancelled', 'interrupted'].includes(status ?? '') ? 1 : 2
  const pendingRows = rows.filter(pr => pr.analysisStatus !== 'completed').sort((a, b) => statusRank(a.analysisStatus) - statusRank(b.analysisStatus) || (b.maxRisk ?? -1) - (a.maxRisk ?? -1) || b.updatedAt.localeCompare(a.updatedAt))
  return <section className="grid gap-4" aria-label="项目 PR 审查">
    <h2 className="sr-only">PR 审查</h2>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="grid gap-3">
        {result?.supported === false ? null : <>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={String(state)} onValueChange={nextValue => { if (nextValue) (value => { setState(value as PRState); setPage(1) })(nextValue as typeof state); }} aria-label="PR 范围">{([{ label: '开放', value: 'open' }, { label: '已结束', value: 'closed' }, { label: '全部', value: 'all' }]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup>
            <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-haspopup="menu" aria-label={`排序方式：${sortBy === 'updated' ? '按最近更新' : '按风险最高'}`} type="button">排序：{sortBy === 'updated' ? '按最近更新' : '按风险最高'}{<ChevronDown aria-hidden="true" focusable="false" strokeWidth={1.5} size={13}/>}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{([{ key: 'updated', label: '按最近更新' }, { key: 'risk', label: '按风险最高' }]).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => setSortBy(key as 'updated' | 'risk'))(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {tracking?.supported === false ? null : <Button onClick={() => setTrackingOpen(true)} variant="outline" type="button">{<span className={cn('size-1.5 rounded-full', tracking?.enabled ? 'bg-teal' : 'bg-foreground-4')} aria-hidden="true"/>}{tracking?.enabled ? '自动分析已开启' : '自动分析'}</Button>}
              <Button variant='default' disabled={busy} onClick={refresh} type="button">{busy ? '正在检查…' : '检查远端 PR'}</Button>
            </div>
          </div>
        </>}

        {batch ? <div className="grid gap-1.5 rounded-sm border border-border-soft p-3">
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
        {batchError && !batch ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-rose/30 bg-rose-soft p-2.5 text-xs text-rose-deep" role="alert"><span>{batchError}</span><Button size="sm" onClick={() => setAttempt(value => value + 1)} variant="outline" type="button">重试读取</Button></div> : null}
        {error ? <FailureNotice error={error} onRetry={refresh}/> : null}
        {busy && !result ? <LoadingNotice label="正在读取项目 PR 清单"/> : null}
        {result && !result.supported ? <EmptyState title="此项目不是公开 GitHub 来源" description="PR 发现和自动分析只读取公开 GitHub；分支分析和风险趋势仍可使用。"/> : null}
        {busy && result ? <ProgressBar value={null} state="queued" label="正在检查远端 PR"/> : null}

        {result?.supported ? <div className="grid gap-3">
          {analysisError ? <div className="rounded-sm border border-rose/30 bg-rose-soft p-2.5 text-xs text-rose-deep" role="alert"><span>{analysisError}</span></div> : null}
          {result.errorCode ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-amber/30 bg-amber-soft p-2.5 text-xs text-amber-deep" role="alert"><span>远端检查未完成（{result.errorCode}）；以下是上次缓存，缺失条目不能认定为已关闭。</span><Button size="sm" disabled={busy} onClick={refresh} variant="outline" type="button">重试检查</Button></div> : null}
          {rows.length ? <div className="grid gap-2">{rows.map(pr => {
            const hasWork = Boolean(result.owner && result.name && localWorks.has(workKey(result.owner, result.name, pr.number)))
            const rowRunning = ['queued', 'running', 'checking', 'collecting', 'scoring'].includes(pr.analysisStatus ?? '')
            const rowLabel = analyzingNumber === pr.number ? '提交中…' : rowRunning ? '分析中…' : ['failed', 'cancelled', 'interrupted'].includes(pr.analysisStatus ?? '') ? '重试分析' : '分析'
            return <article className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border-soft bg-card p-3" key={pr.number}>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-medium text-foreground"><span className="font-mono text-xs text-foreground-3">#{pr.number}</span> {pr.title}</h3>
                  <span className={cn('rounded-sm px-1 py-0.5 text-[11px]', pr.remoteState === 'open' ? 'bg-teal-soft text-teal-deep' : 'bg-soft text-foreground-3')}>{remoteLabel[pr.remoteState]}</span>
                  {pr.draft ? <span className="rounded-sm bg-soft px-1 py-0.5 text-[11px] text-foreground-3">草稿</span> : null}
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-foreground-3">
                  <span>{pr.author}</span>
                  <span>更新于 {displayTime(pr.updatedAt)}</span>
                  <span>{pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'}{pr.modelId ? ` · ${modelName(pr.modelId)}` : ''}{pr.featureSource ? ' · 复用已保存特征' : ''}</span>
                  {pr.maxRisk != null ? <span className="text-foreground-2" title="该 PR 已分析提交中的最高分数；排序参考，不是 PR 整体缺陷概率">{`最高风险 ${pr.maxRisk.toFixed(3)}${pr.scoredCommits != null ? ` · ${pr.scoredCommits} 条有分数` : ''}`}</span> : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result.owner && result.name ? <>
                  {pr.analysisStatus !== 'completed'
                    ? <Button size="sm" variant='outline' disabled={rowRunning || analyzingNumber !== null} onClick={() => void analyzeOne(pr)} type="button">{rowLabel}</Button>
                    : <Button size="sm" variant="ghost" disabled={analyzingNumber !== null} onClick={() => openReanalyze(pr)} type="button">换模型</Button>}
                  <Button size="sm" variant={hasWork ? 'default' : pr.analysisStatus === 'completed' ? 'outline' : 'ghost'} onClick={() => navigate({ name: 'pr-work', repositoryId, owner: result.owner!, repositoryName: result.name!, number: pr.number })} type="button">{hasWork ? '继续审查' : '查看 PR'}</Button>
                </> : <a className="text-xs text-accent underline-offset-2 hover:underline" href={pr.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>}
              </div>
            </article>
          })}</div> : <p className="py-8 text-center text-sm text-muted-foreground">{"当前范围没有 PR"}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-3">
            <span>{result.checkedAt ? `检查于 ${displayTime(result.checkedAt)}` : '尚未检查远端'}{rows.length ? ` · 本页 ${rows.length} 个` : ''}{result.hasMore ? ' · 还有更多页' : ''}{state === 'closed' ? ' · 已结束含已合并' : ''}</span>
            {page > 1 || result.hasMore ? <nav className="flex items-center gap-2" aria-label="PR 分页"><Button size="sm" disabled={busy || page <= 1} onClick={() => setPage(v => v - 1)} variant="outline" type="button">上一页</Button><span>第 {page} 页</span><Button size="sm" disabled={busy || !result.hasMore} onClick={() => setPage(v => v + 1)} variant="outline" type="button">下一页</Button></nav> : null}
          </div>
        </div> : null}
      </div>

      {result?.supported ? <aside className="grid content-start gap-2 rounded-md border border-border-soft bg-card p-3" aria-label="待处理 PR">
        <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-foreground">待处理 PR</h2><span className="text-xs text-foreground-4">{pendingRows.length} 个</span></div>
        <p className="text-xs text-foreground-3">分析中 {summary.running} · 失败 {summary.failed} · 未分析 {summary.none}</p>
        <div className="grid gap-1.5">
          {pendingRows.length === 0 ? <p className="py-4 text-center text-xs text-foreground-3">没有待处理 PR</p> : pendingRows.map(pr => <Button variant="ghost" key={pr.number} type="button" className="block w-full rounded-sm border border-border-soft bg-card p-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => { if (result.owner && result.name) navigate({ name: 'pr-work', repositoryId, owner: result.owner, repositoryName: result.name, number: pr.number }) }}>
            <span className="block truncate text-sm font-medium text-foreground"><b className="font-mono text-xs text-foreground-3">#{pr.number}</b> {pr.title}</span>
            <span className="mt-0.5 block text-xs text-foreground-3">{pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'}{pr.modelId ? ` · ${modelName(pr.modelId)}` : ''}{pr.maxRisk != null ? ` · 最高 ${pr.maxRisk.toFixed(3)}` : ''} · {displayTime(pr.updatedAt)}</span>
          </Button>)}
        </div>
      </aside> : null}
    </div>

    <Dialog open={trackingOpen} onOpenChange={setTrackingOpen}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${620}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{"PR 自动分析"}</DialogTitle></DialogHeader><PRTrackingPanel repositoryId={repositoryId} onTracking={setTracking}/></DialogContent></Dialog>
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${440}px)`, maxWidth: 'none'}}><AlertDialogHeader><AlertDialogTitle>{"取消这次批量分析？"}</AlertDialogTitle><AlertDialogDescription>{"将停止提交后续条目；已入队的单 PR 任务继续执行并保留结果。"}</AlertDialogDescription></AlertDialogHeader><div className="flex justify-end gap-2">
        <Button onClick={() => setCancelOpen(false)} variant="outline" type="button">返回</Button>
        <Button variant='destructive' onClick={() => void cancelBatch()} disabled={Boolean(cancelBusy)} type="button">{cancelBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认取消</Button>
      </div></AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(reanalyzing)} onOpenChange={next => { if (!next) setReanalyzing(null) }}><DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${480}px)`, maxWidth: 'none'}}><DialogHeader><DialogTitle>{reanalyzing ? `换模型分析 #${reanalyzing.number}` : '换模型分析'}</DialogTitle></DialogHeader>{reanalyzeOptions.length
        ? <Select value={reanalyzeModel == null ? '' : String(reanalyzeModel)} onValueChange={nextValue => (setReanalyzeModel)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="重新分析模型"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(reanalyzeOptions).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
        : <p className="text-xs text-foreground-3">没有其他可用的兼容模型</p>}<DialogFooter>{<><Button onClick={() => setReanalyzing(null)} variant="outline" type="button">取消</Button><Button variant='default' disabled={Boolean(!reanalyzeModel) || Boolean(reanalyzeBusy)} onClick={() => void reanalyze()} type="button">{reanalyzeBusy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}开始分析</Button></>}</DialogFooter></DialogContent></Dialog>
  </section>
}
