/**
 * 项目页：一个项目的全部操作都收在这一页。
 *
 * 顺序按使用频率排：先看「当前分析结果」，再决定是否发起新分析，最后才是分析记录。
 * 「当前结果」严格指项目可用于审查的那次成功分析；最近一次尝试可能还在跑或已失败，
 * 两者分开显示，避免一次失败把上一次成功的结果一起弄丢。
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, GitCompare, Info, Loader, MoreHorizontal, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { Button, Disclosure, IconButton } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { Popover } from '../ui/popover'
import type { SyncForm } from '../apiClient'
import { projectsChanged } from '../projectEvents'
import { useModelName } from '../modelClient'
import { AnalysisLauncher } from '../components/AnalysisLauncher'
import { RepositoryUpdates } from '../components/RepositoryUpdates'
import { EmptyState, FailureNotice, LoadingNotice } from '../Feedback'
import type { Route } from '../navigation'
import { cancelRepositorySync, deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '../projectClient'
import { projectStatus } from '../projectStatus'
import { ACTIVE_STATUSES, DEGRADE_LABELS, STATUS_LABELS, type SyncError, type SyncView } from '../repositoryContract'
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
  const [detailJob, setDetailJob] = useState<SyncView | null>(null)
  const [deleteJob, setDeleteJob] = useState<SyncView | null>(null)
  const [cancelJob, setCancelJob] = useState<SyncView | null>(null)
  const [retryDraft, setRetryDraft] = useState<{ key: number; form: Partial<SyncForm> } | null>(null)
  const riskTotal = Math.max(1, detail.repository ? detail.repository.distribution.high + detail.repository.distribution.medium + detail.repository.distribution.low : 1)
  const share = (count: number) => Math.round((count / riskTotal) * 100)
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
          <h1 title={repository.url}>{repository.displayName}</h1>
          <p className={`status-line tone-${status.tone}`} role="status">{status.label}</p>
        </div>
      </div>
      <div className="page-actions">
        <AnalysisLauncher key={retryDraft?.key ?? 'new'} initial={retryDraft?.form} repositoryUrl={repository.url} defaultBranch={repository.defaultBranch} onStarted={() => { setPage(0); records.retry(); detail.retry() }}/>
      </div>
    </header>

    {retryDraft ? <p role="status" className="form-hint">已恢复这次分析的原参数，可以修改后重新发起；原记录会保留。</p> : null}
    <div className="project-workspace">
      <aside className="pw-rail" aria-label="分析记录">
        <div className="pw-rail-head"><h2>分析记录</h2><span>{records.state === 'ready' ? `${records.total} 次` : ''}</span></div>
        {recordError ? <p className="field-error" role="alert">{recordError}</p> : null}
        {records.state === 'loading' && records.syncs.length === 0 ? <LoadingNotice label="正在读取分析记录"/> : records.state === 'error' ? <FailureNotice error={records.error} onRetry={records.retry}/> : records.syncs.length === 0 ? <p className="quiet-empty">还没有分析记录。发起第一次分析后，这里按时间排列。</p> : <div className="job-list pw-timeline">{records.syncs.map(job => <RecordRow key={job.syncId} job={job} current={job.syncId === context?.syncId} selecting={selectingId !== ''} onOpen={() => navigate({ name: 'analysis', repositoryId, viewSyncId: job.syncId, view: 'commits' })} onCompare={context && job.status === 'completed' && job.syncId !== context.syncId ? () => navigate({ name: 'comparison', repositoryId, baseSyncId: job.syncId, targetSyncId: context.syncId }) : undefined} onSelect={() => void makeCurrent(job)} onDelete={() => setDeleteJob(job)} onDetail={() => setDetailJob(job)} onRetry={() => retryRecord(job)} onCancel={() => setCancelJob(job)} deleteBusy={deleteBusy} cancelBusy={cancelBusy}/>) }</div>}
        {records.total > 10 ? <nav className="pager" aria-label="分析记录分页"><span>第 {page + 1} / {Math.ceil(records.total / 10)} 页</span><Button size="sm" disabled={page === 0 || records.state === 'loading'} onClick={() => setPage(value => value - 1)}>上一页</Button><Button size="sm" disabled={(page + 1) * 10 >= records.total || records.state === 'loading'} onClick={() => setPage(value => value + 1)}>下一页</Button></nav> : null}
      </aside>

      <div className="pw-detail">
        <div className="pw-detail-head">
          <h2>当前分析结果</h2>
          <span>{context ? [context.completedAt ? displayTime(context.completedAt) : '', modelName ?? ''].filter(Boolean).join(' · ') : ''}</span>
        </div>
        {context ? <div className="pw-result">
          <div className="result-stats">
            <div><b>{repository.commitCount.toLocaleString()}</b><span>已分析提交</span></div>
            <div className="high"><b>{repository.distribution.high.toLocaleString()}</b><span>高风险</span></div>
            <div><b>{repository.distribution.medium.toLocaleString()}</b><span>中风险</span></div>
            <div><b>{repository.distribution.low.toLocaleString()}</b><span>低风险</span></div>
          </div>
          <div className="result-chart">
            <svg className="result-donut" viewBox="0 0 100 100" role="img" aria-label={`风险分布：高 ${repository.distribution.high} 条、中 ${repository.distribution.medium} 条、低 ${repository.distribution.low} 条`}>
              <circle className="donut-track" cx="50" cy="50" r="40"/>
              {donutSegments(repository.distribution.high, repository.distribution.medium, repository.distribution.low).map(segment => <circle key={segment.key} className={`donut-${segment.key}`} cx="50" cy="50" r="40" strokeDasharray={`${segment.length} ${DONUT_CIRCUMFERENCE - segment.length}`} strokeDashoffset={-segment.offset}/>)}
            </svg>
            <dl className="result-chart-legend">
              <div><dt><i className="is-high"/>高风险</dt><dd><b>{repository.distribution.high.toLocaleString()}</b><em>{share(repository.distribution.high)}%</em></dd></div>
              <div><dt><i className="is-mid"/>中风险</dt><dd><b>{repository.distribution.medium.toLocaleString()}</b><em>{share(repository.distribution.medium)}%</em></dd></div>
              <div><dt><i className="is-low"/>低风险</dt><dd><b>{repository.distribution.low.toLocaleString()}</b><em>{share(repository.distribution.low)}%</em></dd></div>
            </dl>
          </div>
          {repository.degradeReason ? <p className="result-note">模型说明：{DEGRADE_LABELS[repository.degradeReason] ?? repository.degradeReason}</p> : null}
          <div className="result-foot">
            <div className="result-info">
              <p className="result-meta">
                <span className="result-chip">分支 <b>{context.branch}</b></span>
                <span className="result-chip" title={context.datasetVersion ?? ''}>数据 <b>{datasetRange(context.datasetVersion)}</b></span>
              </p>
            </div>
            <Button aria-label="查看提交与审查计划" variant="link" size="sm" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: context.syncId, view: 'commits' })}>查看提交与审查计划<ArrowRight size={14}/></Button>
          </div>
        </div> : <div className="result-empty">
          <p>还没有可用的分析结果。{latest?.status === 'failed' ? '最近一次分析失败，修正后重新发起。' : latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? '分析进行中，完成后这里会出现结果。' : ''}</p>
        </div>}
      </div>
    </div>

    <Disclosure className="pw-updates" summary={<><span>仓库更新与自动检查</span><span className="pw-updates-meta">{repository.url.replace(/^https?:\/\//, '')} · {context?.branch ?? repository.defaultBranch} · {repository.commitCount.toLocaleString()} 个已分析提交</span></>}>
      <RepositoryUpdates key={repositoryId} repositoryId={repositoryId} onUpdated={() => { detail.retry(); records.retry(); projectsChanged() }}/>
    </Disclosure>

    <Dialog open={Boolean(detailJob)} onOpenChange={next => { if (!next) setDetailJob(null) }} title="分析详情" width={480}>
      {detailJob ? <RecordDetails job={detailJob} active={(ACTIVE_STATUSES as readonly string[]).includes(detailJob.status)}/> : null}
    </Dialog>
    <Dialog
      open={Boolean(deleteJob)}
      onOpenChange={next => { if (!next) setDeleteJob(null) }}
      title="删除这条分析记录？"
      description={deleteJob && deleteJob.syncId === context?.syncId ? '这是当前结果，删除后项目将暂时没有当前结果，其他成功记录仍可重新选择。此操作无法撤销。' : '这次分析与对应的提交结果将被删除。此操作无法撤销。'}
      width={460}
      footer={<>
        <Button onClick={() => setDeleteJob(null)}>取消</Button>
        <Button variant="danger" loading={deleteBusy} onClick={() => { if (deleteJob) void removeRecord(deleteJob).then(() => setDeleteJob(null)) }}>确认删除记录</Button>
      </>}
    >{null}</Dialog>
    <Dialog
      open={Boolean(cancelJob)}
      onOpenChange={next => { if (!next) setCancelJob(null) }}
      title="取消这次分析？"
      description="取消后这次分析不再继续，已经生成的结果不会保留；可以用原参数重新发起。"
      width={440}
      footer={<>
        <Button onClick={() => setCancelJob(null)}>返回</Button>
        <Button variant="danger" loading={cancelBusy} onClick={() => { if (cancelJob) void cancelRecord(cancelJob).then(() => setCancelJob(null)) }}>确认取消分析</Button>
      </>}
    >{null}</Dialog>
  </section>
}

function RecordRow({ job, current, selecting, onOpen, onCompare, onSelect, onDelete, onDetail, onRetry, onCancel, deleteBusy, cancelBusy }: { job: SyncView; current: boolean; selecting: boolean; onOpen: () => void; onCompare?: () => void; onSelect: () => void; onDelete: () => void; onDetail: () => void; onRetry: () => void; onCancel: () => void; deleteBusy: boolean; cancelBusy: boolean }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  const completed = job.status === 'completed'
  const pendingCancel = active && Boolean(job.cancelRequestedAt)
  const title = pendingCancel ? '正在取消' : completed && current ? '当前结果' : job.status === 'queued' && job.queuePosition ? `排队第 ${job.queuePosition} 位` : STATUS_LABELS[active ? job.stage : job.status]
  const meta = `${shortTime(job.createdAt)} · ${syncSpan(job)}`
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
        <span className={`job-status-icon ${active ? 'is-active' : 'is-failed'}`}>{active ? <Loader size={16}/> : <AlertTriangle size={16}/>}</span>
        <span className="record-text">
          <span className="record-title">{title}</span>
          <span className="record-meta">{meta}</span>
        </span>
      </div>}
      <RecordMenu job={job} active={active} pendingCancel={pendingCancel} onOpen={completed ? onOpen : undefined} onCompare={onCompare} onRetry={!active && !completed ? onRetry : undefined} onCancel={active && !pendingCancel ? onCancel : undefined} onDetail={onDetail} onDelete={!active ? onDelete : undefined} cancelBusy={cancelBusy} deleteBusy={deleteBusy}/>
    </div>
    {job.error ? <p className="record-error" title={job.error.message}><AlertTriangle size={13}/>{failureText(job.error)}</p> : job.status === 'cancelled' ? <p className="record-note">已取消，可用原参数重新分析。</p> : null}
  </article>
}

/** 记录详情：放进浮层，避免在列表里向下展开把卡片撑长。 */
function RecordDetails({ job, active }: { job: SyncView; active: boolean }) {
  return <dl className="record-details">
    <div><dt>范围</dt><dd>{job.since ?? '不限'} — {job.until ?? '不限'}，最多 {job.commitLimit} 条</dd></div>
    <div><dt>分支</dt><dd>{job.branch}</dd></div>
    {job.startedAt ? <div><dt>开始执行</dt><dd>{displayTime(job.startedAt)}</dd></div> : null}
    {active && job.deadlineAt ? <div><dt>执行截止</dt><dd>{displayTime(job.deadlineAt)}</dd></div> : null}
    <div><dt>数据</dt><dd>{job.datasetVersion ?? '尚未生成'}</dd></div>
    {job.degradeReason ? <div><dt>模型说明</dt><dd>{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}
    {job.requestId ? <div><dt>请求标识</dt><dd><code>{job.requestId}</code></dd></div> : null}
  </dl>
}
const DONUT_CIRCUMFERENCE = 2 * Math.PI * 40

/** 圆环的三段弧：长度按占比，偏移按累计长度。 */
function donutSegments(high: number, medium: number, low: number) {
  const total = Math.max(1, high + medium + low)
  let offset = 0
  return [
    { key: 'high', value: high },
    { key: 'mid', value: medium },
    { key: 'low', value: low },
  ].map(item => {
    const length = (item.value / total) * DONUT_CIRCUMFERENCE
    const segment = { key: item.key, length, offset }
    offset += length
    return segment
  })
}

/** 数据集版本号末尾是采集区间，长串只留日期，完整值放在 title 里。 */
function datasetRange(version?: string | null) {
  if (!version) return '未登记'
  const range = version.match(/(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/)
  return range ? `${range[1]} → ${range[2].slice(5)}` : version
}
/** 记录卡只放一个入口：点开后再选具体动作，避免每行三四个图标。 */
function RecordMenu({ job, pendingCancel, onOpen, onCompare, onRetry, onCancel, onDetail, onDelete, cancelBusy, deleteBusy }: {
  job: SyncView
  active: boolean
  pendingCancel: boolean
  onOpen?: () => void
  onCompare?: () => void
  onRetry?: () => void
  onCancel?: () => void
  onDetail: () => void
  onDelete?: () => void
  cancelBusy: boolean
  deleteBusy: boolean
}) {
  const [open, setOpen] = useState(false)
  const choose = (action?: () => void) => () => { setOpen(false); action?.() }
  return <Popover open={open} onOpenChange={setOpen} label={`分析记录 ${job.syncId} 的操作`} trigger={<IconButton label="更多操作" icon={<MoreHorizontal size={16}/>}/>}>
    <div className="record-menu" role="menu" aria-label="分析记录操作">
      {onOpen ? <button type="button" role="menuitem" className="record-menu-item" onClick={choose(onOpen)}><ArrowUpRight size={14}/>打开结果</button> : null}
      {onCompare ? <button type="button" role="menuitem" className="record-menu-item" onClick={choose(onCompare)}><GitCompare size={14}/>与当前结果对比</button> : null}
      {onRetry ? <button type="button" role="menuitem" className="record-menu-item" onClick={choose(onRetry)}><RotateCcw size={14}/>用这些参数重试</button> : null}
      {onCancel ? <button type="button" role="menuitem" className="record-menu-item" disabled={cancelBusy} onClick={choose(onCancel)}><XCircle size={14}/>取消分析</button> : null}
      {pendingCancel ? <p className="record-menu-note">正在取消…</p> : null}
      <button type="button" role="menuitem" className="record-menu-item" onClick={choose(onDetail)}><Info size={14}/>分析详情</button>
      {onDelete ? <button type="button" role="menuitem" className="record-menu-item is-danger" disabled={deleteBusy} onClick={choose(onDelete)}><Trash2 size={14}/>删除记录</button> : null}
    </div>
  </Popover>
}

/** 失败原因：常见错误给一句人话，原始信息留在详情里。 */
const FAILURE_TEXT: Record<string, string> = {
  DATASET_EXISTS: '这个日期区间的数据版本已登记且内容不同，换起始日期或先删除旧版本',
  REPOSITORY_UNAVAILABLE: '无法读取仓库，检查网络或地址后重试',
  REPOSITORY_CHECK_TIMEOUT: '检查远端仓库超时，可以重试',
  CONFLICT_ACTIVE_SYNC: '已有进行中的分析，结束后再试',
  DATASET_INVALID: '这个范围内没有可分析的提交，调整日期后重试',
  SYNC_TIMEOUT: '分析超过时限，缩小范围后重试',
  SYNC_INTERRUPTED: '服务停止时分析中断，可以重试',
  SYNC_CANCELLED: '这次分析已取消，可以重试',
}

function failureText(error: SyncError) {
  return FAILURE_TEXT[error.code] ?? error.message
}
/** 记录的时间跨度：用采集区间，保持一行可读。 */
function syncSpan(job: SyncView) {
  return `${shortDay(job.since)} → ${shortDay(job.until)}`
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
