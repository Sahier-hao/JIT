import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Empty } from '../ui/feedback'
import { Segmented } from '../ui/segmented'
import { Button, Select } from '../ui/controls'
import { Dropdown } from '../ui/dropdown'
import { Dialog } from '../ui/dialog'
import { EmptyState, FailureNotice, LoadingNotice } from '../Feedback'
import { displayTime } from '../domain'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { analyzeProjectPR, cancelProjectPRBatch, getTracking, latestProjectPRBatch, projectPRs, retryProjectPRBatch, type PRBatch, type PRState, type PRTracking, type ProjectPR, type ProjectPRPage } from '../projectActivityClient'
import { cacheKey, readCache, writeCache } from '../lib/localCache'
import { readWorks, workKey } from '../prReview'
import type { Route } from '../navigation'
import { PR_BATCH_CHANGED } from '../projectEvents'
import { PRTrackingPanel } from './PRTrackingPanel'
import { ProgressBar } from './JobProgress'

const remoteLabel = { open: '开放中', closed: '已关闭', merged: '已合并' }
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
  try { localWorks = new Set(readWorks().map(work => work.key)) } catch { /* 本地存储损坏时仍允许查看远端 PR */ }
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
  return <section className="pr-hub" aria-label="项目 PR 审查">
    <h2 className="sr-only">PR 审查</h2>
    <div className="pr-hub-layout">
    <div className="pr-hub-main">
    {result?.supported === false ? null : <>
      <div className="pr-hub-toolbar">
        <div className="pr-hub-filters">
          <Segmented aria-label="PR 范围" value={state} onChange={value => { setState(value as PRState); setPage(1) }} options={[{ label: '开放', value: 'open' }, { label: '已结束', value: 'closed' }, { label: '全部', value: 'all' }]}/>
        </div>
        <span className="pr-hub-sort">
          <Dropdown
            items={[{ key: 'updated', label: '按最近更新' }, { key: 'risk', label: '按风险最高' }]}
            onClick={key => setSortBy(key as 'updated' | 'risk')}
          >
            <Button
              variant="ghost"
              size="sm"
              className="pr-hub-sort-btn"
              aria-haspopup="menu"
              aria-label={`排序方式：${sortBy === 'updated' ? '按最近更新' : '按风险最高'}`}
              trailing={<ChevronDown size={13} aria-hidden/>}
            >排序：{sortBy === 'updated' ? '按最近更新' : '按风险最高'}</Button>
          </Dropdown>
        </span>
        <div className="pr-hub-actions">
          {tracking?.supported === false ? null : <Button icon={<span className="pr-auto-dot" data-on={tracking?.enabled ? 'true' : undefined} aria-hidden="true"/>} onClick={() => setTrackingOpen(true)}>{tracking?.enabled ? '自动分析已开启' : '自动分析'}</Button>}
          <Button variant="primary" disabled={busy} onClick={refresh}>{busy ? '正在检查…' : '检查远端 PR'}</Button>
        </div>
      </div>
    </>}
    {batch ? <div className="pr-batch" data-status={batch.status}>
      <ProgressBar value={batch.discovered ? Math.round(((batch.counts.completed + batch.counts.failed + batch.counts.cancelled + batch.counts.interrupted) / batch.discovered) * 100) : null}
        state={batch.status === 'failed' ? 'failed' : batch.status === 'completed' && batch.counts.completed + batch.counts.failed + batch.counts.cancelled + batch.counts.interrupted >= batch.discovered ? 'done' : batch.status === 'discovering' ? 'queued' : 'running'}
        label="批量分析进度"/>
    <div className="pr-batch-line" data-status={batch.status}>
      <span className="pr-batch-state">批量分析 · {batchLabel[batch.status] ?? batch.status}</span>
      <span>{batch.discoveryComplete ? `范围 ${batch.discovered} 个开放 PR` : `已发现 ${batch.discovered} 个，范围未完整获取`}</span>
      <span>已入队 {batch.submission.submitted} · 复用 {batch.submission.reused} · 失败 {batch.counts.failed} · 待处理 {batch.submission.pending}</span>
      {batch.counts.cancelled || batch.counts.interrupted ? <span>取消/中断 {batch.counts.cancelled + batch.counts.interrupted}</span> : null}
      {batch.counts.queued || batch.counts.running ? <span>分析中 {batch.counts.queued + batch.counts.running}</span> : null}
      <span>模型 {modelName(batch.modelId)}</span>
      {batch.error ? <span role="alert">{batch.error.message}</span> : null}
      {batchError ? <span role="alert">{batchError}</span> : null}
      {batch.status !== 'cancelled' && (batch.status === 'discovering' || batch.status === 'running') ? <Button size="sm" disabled={batchBusy || cancelBusy || batch.cancelRequested} onClick={() => setCancelOpen(true)}>{batch.cancelRequested || cancelBusy ? '正在取消…' : '取消批次'}</Button> : null}
      {batch.counts.failed > 0 && !batchActive ? <Button size="sm" disabled={batchBusy} onClick={() => void retryItems('failed')}>{batchBusy ? '正在重试…' : '仅重试失败项'}</Button> : null}
      {batch.counts.interrupted > 0 && !batchActive ? <Button size="sm" disabled={batchBusy} onClick={() => void retryItems('interrupted')}>{batchBusy ? '正在重试…' : '重新分析中断项'}</Button> : null}
    </div>
    </div> : null}
    {batchError && !batch ? <div className="pr-hub-alert" role="alert"><span>{batchError}</span><Button size="sm" onClick={() => setAttempt(value => value + 1)}>重试读取</Button></div> : null}
    {error ? <FailureNotice error={error} onRetry={refresh}/> : null}
    {busy && !result ? <LoadingNotice label="正在读取项目 PR 清单"/> : null}
    {result && !result.supported ? <EmptyState title="此项目不是公开 GitHub 来源" description="PR 发现和自动分析只读取公开 GitHub；分支分析和风险趋势仍可使用。"/> : null}
    {busy && result ? <ProgressBar value={null} state="queued" label="正在检查远端 PR"/> : null}
    {result?.supported ? <div className="pr-hub-panel">
      {analysisError ? <div className="pr-hub-alert" role="alert"><span>{analysisError}</span></div> : null}
      {result.errorCode ? <div className="pr-hub-alert" role="alert"><span>远端检查未完成（{result.errorCode}）；以下是上次缓存，缺失条目不能认定为已关闭。</span><Button size="sm" disabled={busy} onClick={refresh}>重试检查</Button></div> : null}
      {rows.length ? <div className="pr-hub-list">{rows.map(pr => {
        const hasWork = Boolean(result.owner && result.name && localWorks.has(workKey(result.owner, result.name, pr.number)))
        const rowRunning = ['queued', 'running', 'checking', 'collecting', 'scoring'].includes(pr.analysisStatus ?? '')
        const rowLabel = analyzingNumber === pr.number ? '提交中…' : rowRunning ? '分析中…' : ['failed', 'cancelled', 'interrupted'].includes(pr.analysisStatus ?? '') ? '重试分析' : '分析'
        return <article className="pr-row" key={pr.number}>
          <div className="pr-row-main">
            <div className="pr-row-title"><h3><span className="pr-row-number">#{pr.number}</span> {pr.title}</h3><span className="pr-row-state" data-state={pr.remoteState}>{remoteLabel[pr.remoteState]}</span>{pr.draft ? <span className="pr-row-draft">草稿</span> : null}</div>
            <p className="pr-row-meta"><span>{pr.author}</span><span>更新于 {displayTime(pr.updatedAt)}</span><span>{pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'}{pr.modelId ? ` · ${modelName(pr.modelId)}` : ''}{pr.featureSource ? ' · 复用已保存特征' : ''}</span>{pr.maxRisk != null ? <span className="pr-row-risk" title="该 PR 已分析提交中的最高分数；排序参考，不是 PR 整体缺陷概率">{`最高风险 ${pr.maxRisk.toFixed(3)}${pr.scoredCommits != null ? ` · ${pr.scoredCommits} 条有分数` : ''}`}</span> : null}</p>
          </div>
          <div className="pr-row-actions">
            {result.owner && result.name ? <>
              {pr.analysisStatus !== 'completed'
                ? <Button size="sm" variant="secondary" disabled={rowRunning || analyzingNumber !== null} onClick={() => void analyzeOne(pr)}>{rowLabel}</Button>
                : <Button size="sm" variant="ghost" disabled={analyzingNumber !== null} onClick={() => openReanalyze(pr)}>换模型</Button>}
              <Button size="sm" variant={hasWork ? 'primary' : pr.analysisStatus === 'completed' ? 'secondary' : 'ghost'} onClick={() => navigate({ name: 'pr-work', repositoryId, owner: result.owner!, repositoryName: result.name!, number: pr.number })}>{hasWork ? '继续审查' : '查看 PR'}</Button>
            </> : <a href={pr.url} target="_blank" rel="noreferrer">在 GitHub 核对</a>}
          </div>
        </article>
      })}</div> : <div className="pr-hub-empty"><Empty description="当前范围没有 PR"/></div>}
      <div className="pr-hub-foot">
        <span>{result.checkedAt ? `检查于 ${displayTime(result.checkedAt)}` : '尚未检查远端'}{rows.length ? ` · 本页 ${rows.length} 个` : ''}{result.hasMore ? ' · 还有更多页' : ''}{state === 'closed' ? ' · 已结束含已合并' : ''}</span>
        {page > 1 || result.hasMore ? <nav className="pr-hub-pager" aria-label="PR 分页"><Button size="sm" disabled={busy || page <= 1} onClick={() => setPage(v => v - 1)}>上一页</Button><span>第 {page} 页</span><Button size="sm" disabled={busy || !result.hasMore} onClick={() => setPage(v => v + 1)}>下一页</Button></nav> : null}
      </div>
    </div> : null}
    </div>
    {result?.supported ? <aside className="pr-hub-records" aria-label="待处理 PR">
      <div className="pw-rail-head"><h2>待处理 PR</h2><span>{pendingRows.length} 个</span></div>
      <p className="pr-hub-records-summary">分析中 {summary.running} · 失败 {summary.failed} · 未分析 {summary.none}</p>
      <div className="pr-record-list">
        {pendingRows.length === 0 ? <p className="quiet-empty">没有待处理 PR</p> : pendingRows.map(pr => <button key={pr.number} type="button" className="pr-record" data-status={pr.analysisStatus ?? 'none'} onClick={() => { if (result.owner && result.name) navigate({ name: 'pr-work', repositoryId, owner: result.owner, repositoryName: result.name, number: pr.number }) }}>
          <span className="pr-record-title"><b>#{pr.number}</b> {pr.title}</span>
          <span className="pr-record-meta">{pr.analysisStatus ? analysisLabel[pr.analysisStatus] ?? pr.analysisStatus : '尚无分析'}{pr.modelId ? ` · ${modelName(pr.modelId)}` : ''}{pr.maxRisk != null ? ` · 最高 ${pr.maxRisk.toFixed(3)}` : ''} · {displayTime(pr.updatedAt)}</span>
        </button>)}
      </div>
    </aside> : null}
    </div>
    <Dialog open={trackingOpen} onOpenChange={setTrackingOpen} title="PR 自动分析" width={620}>
      <PRTrackingPanel repositoryId={repositoryId} onTracking={setTracking}/>
    </Dialog>
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="取消这次批量分析？" width={440}
      description="将停止提交后续条目；已入队的单 PR 任务继续执行并保留结果。">
      <div className="pr-row-actions">
        <Button onClick={() => setCancelOpen(false)}>返回</Button>
        <Button variant="danger" loading={cancelBusy} onClick={() => void cancelBatch()}>确认取消</Button>
      </div>
    </Dialog>
    <Dialog open={Boolean(reanalyzing)} onOpenChange={next => { if (!next) setReanalyzing(null) }} title={reanalyzing ? `换模型分析 #${reanalyzing.number}` : '换模型分析'} width={480}
      footer={<><Button onClick={() => setReanalyzing(null)}>取消</Button><Button variant="primary" loading={reanalyzeBusy} disabled={!reanalyzeModel} onClick={() => void reanalyze()}>开始分析</Button></>}>
      {reanalyzeOptions.length
        ? <Select ariaLabel="重新分析模型" value={reanalyzeModel} onChange={setReanalyzeModel} options={reanalyzeOptions}/>
        : <p className="field-hint">没有其他可用的兼容模型</p>}
    </Dialog>
  </section>
}

