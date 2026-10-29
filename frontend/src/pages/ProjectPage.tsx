/**
 * 项目页：一个项目的全部操作都收在这一页。
 *
 * 顺序按使用频率排：先看「当前分析结果」，再决定是否发起新分析，最后才是分析记录。
 * 「当前结果」严格指项目可用于审查的那次成功分析；最近一次尝试可能还在跑或已失败，
 * 两者分开显示，避免一次失败把上一次成功的结果一起弄丢。
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button, Disclosure } from '../ui/controls'
import { Popconfirm } from '../ui/dialog'
import type { SyncForm } from '../apiClient'
import { projectsChanged } from '../projectEvents'
import { useModelName } from '../modelClient'
import { AnalysisLauncher } from '../components/AnalysisLauncher'
import { RepositoryUpdates } from '../components/RepositoryUpdates'
import { EmptyState, FailureNotice, LoadingNotice } from '../Feedback'
import { Icon } from '../Icon'
import type { Route } from '../navigation'
import { cancelRepositorySync, deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '../projectClient'
import { projectStatus } from '../projectStatus'
import { ACTIVE_STATUSES, DEGRADE_LABELS, STATUS_LABELS, STRATEGY_LABELS, type SyncView } from '../repositoryContract'
import { useRepository } from '../repositoryWorkspace'
import { displayTime } from '../domain'

function retryDate(value: string | null, exclusiveEnd = false): string {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  // Stored windows use UTC midnight and an exclusive upper bound; date inputs use inclusive days.
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? new Date(epoch - (exclusiveEnd ? 86400000 : 0)).toISOString().slice(0, 10) : ''
}

export function ProjectPage({ repositoryId, navigate }: { repositoryId: string; navigate: (route: Route, replace?: boolean) => void }) {
  const detail = useRepository(repositoryId)
  const modelName = useModelName(detail.repository?.modelId)
  const [page, setPage] = useState(0)
  const records = useRepositorySyncs(repositoryId, 10, page * 10)
  const refreshRecords = records.retry
  const [recordError, setRecordError] = useState('')
  const [selectingId, setSelectingId] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const cancelLock = useRef(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const deleteLock = useRef(false)
  const [retryDraft, setRetryDraft] = useState<{ key: number; form: Partial<SyncForm> } | null>(null)
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

  if (detail.state === 'loading' && !detail.repository) return <LoadingNotice label="正在读取项目"/>
  if (detail.state === 'error' || !detail.repository) {
    return <EmptyState title="项目读取失败" description={detail.error} tone="alert"><Button onClick={detail.retry}>重新加载</Button><Button onClick={() => navigate({ name: 'repositories' })}>返回项目列表</Button></EmptyState>
  }

  const repository = detail.repository
  const latest = records.syncs[0] ?? repository.latestSync
  const status = projectStatus(repository, latest)
  const context = repository.viewContext

  async function makeCurrent(job: SyncView) {
    if (selectingId !== '') return
    if (recordError !== '') setRecordError('')
    setSelectingId(job.syncId)
    try {
      await selectRepositoryView(repositoryId, job.syncId)
      detail.retry()
      records.retry()
    } catch (failure) {
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
  function retryRecord(job: SyncView) {
    setRetryDraft(previous => ({ key: (previous?.key ?? 0) + 1, form: {
      repositoryUrl: repository.url,
      branch: job.branch,
      since: retryDate(job.since),
      until: retryDate(job.until, true),
      commitLimit: String(job.commitLimit),
      strategy: job.requestedStrategy,
      modelId: job.requestedModelId ?? (job.requestedStrategy === 'generic-model' || job.modelStrategy === 'generic-model' ? job.resolvedModelId : '') ?? '',
    } }))
  }

  return <section className="project-page">
    <Button aria-label="全部项目" variant="ghost" size="sm" icon={<ArrowLeft size={14}/>} onClick={() => navigate({ name: 'repositories' })}>全部项目</Button>
    <header className="page-heading project-heading">
      <div>
        <div className="project-title-row">
          <h1>{repository.displayName}</h1>
          <p className={`status-line tone-${status.tone}`} role="status">{status.label}</p>
        </div>
        <p className="project-url">{repository.url}</p>
        <p className="page-intro">{repository.defaultBranch || '默认分支'} · {repository.commitCount.toLocaleString()} 个已分析提交 · 建立于 {displayTime(repository.createdAt)}</p>
      </div>
      <div className="page-actions">
        {context ? <Button aria-label="打开审查" variant="primary" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: context.syncId, view: 'commits' })}>打开审查<ArrowRight size={14}/></Button> : null}
      </div>
    </header>

    <div className="project-layout">
      <aside className="project-rail">
        <RepositoryUpdates key={repositoryId} repositoryId={repositoryId} onUpdated={() => { detail.retry(); records.retry(); projectsChanged() }}/>

        <section className="project-start" id="analysis-form-section" aria-label="发起分析">
          
          {retryDraft ? <p role="status" className="form-hint">已恢复这次分析的原参数，可以修改后重新发起；原记录会保留。</p> : null}
          <AnalysisLauncher key={retryDraft?.key ?? 'new'} initial={retryDraft?.form} repositoryUrl={repository.url} defaultBranch={repository.defaultBranch} onStarted={() => { setPage(0); records.retry(); detail.retry() }}/>
        </section>
      </aside>

      <div className="project-main">
    <section className="project-result" aria-label="当前分析结果">
      <div className="section-label"><h2>当前分析结果</h2>{context ? <span>完成于 {context.completedAt ? displayTime(context.completedAt) : '未记录'}</span> : null}</div>
      {context ? <div className="result-panel">
        <div className="result-stats">
          <div><b>{repository.commitCount.toLocaleString()}</b><span>已分析提交</span></div>
          <div className="high"><b>{repository.distribution.high.toLocaleString()}</b><span>高风险</span></div>
          <div><b>{repository.distribution.medium.toLocaleString()}</b><span>中风险</span></div>
          <div><b>{repository.distribution.low.toLocaleString()}</b><span>低风险</span></div>
        </div>
        {repository.degradeReason ? <p className="result-note">模型说明：{DEGRADE_LABELS[repository.degradeReason] ?? repository.degradeReason}</p> : null}
        <div className="result-foot">
          <div className="result-info">
            <p className="result-meta">
              <span>{modelName ?? (repository.modelId ? '已保存模型（名称暂不可用）' : '未记录')}</span>
              <span>{context.branch}</span>
              <span>{repository.modelStrategy === 'generic-model' ? '现成模型' : repository.modelStrategy === 'repository-trained' ? '本仓库数据训练' : '未记录'}</span>
            </p>
            <p className="result-version" title={context.datasetVersion ?? ''}><span>数据版本</span> <code>{context.datasetVersion ?? '未登记'}</code></p>
          </div>
          <Button aria-label="查看提交与审查计划" variant="link" size="sm" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: context.syncId, view: 'commits' })}>查看提交与审查计划<ArrowRight size={14}/></Button>
        </div>
      </div> : <div className="result-empty">
        <p>还没有可用的分析结果。{latest?.status === 'failed' ? '最近一次分析失败，修正后重新发起。' : latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? '分析进行中，完成后这里会出现结果。' : ''}</p>
      </div>}
    </section>

    <section className="project-records" aria-label="分析记录">
      <div className="section-label"><h2>分析记录</h2><span>{records.state === 'ready' ? `${records.total} 条` : ''}</span></div>
      {recordError ? <p className="field-error" role="alert">{recordError}</p> : null}
      {records.state === 'loading' && records.syncs.length === 0 ? <LoadingNotice label="正在读取分析记录"/> : records.state === 'error' ? <FailureNotice error={records.error} onRetry={records.retry}/> : records.syncs.length === 0 ? <p className="quiet-empty">还没有分析记录。设置范围后开始第一次分析。</p> : <div className="job-list">{records.syncs.map(job => <RecordRow key={job.syncId} job={job} current={job.syncId === context?.syncId} selecting={selectingId !== ''} onOpen={() => navigate({ name: 'analysis', repositoryId, viewSyncId: job.syncId, view: 'commits' })} onCompare={context && job.status === 'completed' && job.syncId !== context.syncId ? () => navigate({ name: 'comparison', repositoryId, baseSyncId: job.syncId, targetSyncId: context.syncId }) : undefined} onSelect={() => void makeCurrent(job)} onDelete={() => void removeRecord(job)} onRetry={() => retryRecord(job)} onCancel={() => void cancelRecord(job)} deleteBusy={deleteBusy} cancelBusy={cancelBusy}/>) }</div>}
      {records.total > 10 ? <nav className="pager" aria-label="分析记录分页"><span>第 {page + 1} / {Math.ceil(records.total / 10)} 页 · 共 {records.total} 条</span><Button size="sm" disabled={page === 0 || records.state === 'loading'} onClick={() => setPage(value => value - 1)}>上一页</Button><Button size="sm" disabled={(page + 1) * 10 >= records.total || records.state === 'loading'} onClick={() => setPage(value => value + 1)}>下一页</Button></nav> : null}
    </section>
      </div>
    </div>
  </section>
}

function RecordRow({ job, current, selecting, onOpen, onCompare, onSelect, onDelete, onRetry, onCancel, deleteBusy, cancelBusy }: { job: SyncView; current: boolean; selecting: boolean; onOpen: () => void; onCompare?: () => void; onSelect: () => void; onDelete: () => void; onRetry: () => void; onCancel: () => void; deleteBusy: boolean; cancelBusy: boolean }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  const completed = job.status === 'completed'
  const pendingCancel = active && Boolean(job.cancelRequestedAt)
  const title = pendingCancel ? '正在取消' : completed && current ? '当前结果' : job.status === 'queued' && job.queuePosition ? `排队第 ${job.queuePosition} 位` : STATUS_LABELS[active ? job.stage : job.status]
  const meta = `${displayTime(job.createdAt)} · ${STRATEGY_LABELS[job.requestedStrategy]}`
  const shortId = job.syncId.slice(0, 7)
  return <article className={`analysis-job ${current ? 'is-current' : ''}`} data-current={current || undefined} aria-label={`分析记录 ${job.syncId}`}>
    <div className="job-main">
      {completed ? <label className="record-pick">
        <input
          type="radio"
          name="current-analysis"
          checked={current}
          disabled={selecting}
          onChange={onSelect}
          aria-label={current ? `当前结果 ${shortId}` : `将 ${shortId} 设为当前结果`}
        />
        <span className="record-radio" aria-hidden/>
        <span className="record-text">
          <span className="record-title">{title}</span>
          <span className="record-meta">{meta}{selecting ? ' · 正在切换…' : ''}</span>
        </span>
      </label> : <div className="record-pick is-static">
        <span className={`job-status-icon ${active ? 'is-active' : 'is-failed'}`}><Icon name="info" size={17}/></span>
        <span className="record-text">
          <span className="record-title">{title}</span>
          <span className="record-meta">{meta}</span>
        </span>
      </div>}
      <div className="panel-actions">
        {active ? pendingCancel ? <Button variant="link" size="sm" disabled>正在取消…</Button> : <Popconfirm label={cancelBusy ? '正在取消…' : '取消分析'} title="取消这次分析？" description="停止这次分析，保留记录及已有成功结果。取消完成后可以用原参数重新分析。" confirmText="确认取消分析" danger onConfirm={onCancel}/> : null}
        {completed ? <Button variant="link" size="sm" onClick={onOpen}>打开结果</Button> : null}
        {onCompare ? <Button variant="link" size="sm" onClick={onCompare}>与当前结果对比</Button> : null}
        {!active && !completed ? <Button variant="link" size="sm" onClick={onRetry}>用这些参数重试</Button> : null}
        {!active ? <Popconfirm label={deleteBusy ? '正在删除…' : '删除记录'} title="删除这条分析记录？" description={current ? '这是当前结果，删除后项目将暂时没有当前结果，其他成功记录仍可重新选择。此操作无法撤销。' : '这次分析与对应的提交结果将被删除。此操作无法撤销。'} confirmText="确认删除记录" danger onConfirm={onDelete}/> : null}
      </div>
    </div>
    {job.status === 'cancelled' ? <p className="form-hint">本次分析已取消，已有成功结果保持不变，可用原参数重新分析。</p> : job.error ? <p className="job-error" role="alert">{job.error.message} 请修正后重新分析。</p> : null}
    <Disclosure className="job-details" summary="分析详情"><dl>
      <div><dt>范围</dt><dd>{job.since ?? '不限'} — {job.until ?? '不限'}，最多 {job.commitLimit} 条</dd></div>
      <div><dt>分支</dt><dd>{job.branch}</dd></div>
      {job.startedAt ? <div><dt>开始执行</dt><dd>{displayTime(job.startedAt)}</dd></div> : null}
      {active && job.deadlineAt ? <div><dt>执行截止</dt><dd>{displayTime(job.deadlineAt)}</dd></div> : null}
      <div><dt>数据</dt><dd>{job.datasetVersion ?? '尚未生成'}</dd></div>
      {job.degradeReason ? <div><dt>模型说明</dt><dd>{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}
      {job.requestId ? <div><dt>请求标识</dt><dd><code>{job.requestId}</code></dd></div> : null}
    </dl></Disclosure>
  </article>
}
