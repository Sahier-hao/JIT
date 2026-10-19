import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRepositorySync, fetchRepositorySyncs } from './apiClient'
import { FailureNotice, LoadingNotice } from './Feedback'
import { Icon } from './Icon'
import { displayTime } from './domain'
import { ACTIVE_STATUSES, STATUS_LABELS, STRATEGY_LABELS, DEGRADE_LABELS, repositoryName, type SyncPage, type SyncStrategy, type SyncView } from './repositoryContract'

const EMPTY = { repositoryUrl: '', branch: '', since: '', until: '', commitLimit: '500', strategy: 'auto' as SyncStrategy }
export function RepositorySourcesPage({ onOpenSync }: { onOpenSync: (repositoryId: string, syncId?: string) => void }) {
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<unknown>(null)
  const [page, setPage] = useState<SyncPage | null>(null)
  const [readError, setReadError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const [createdId, setCreatedId] = useState('')
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const result = await fetchRepositorySyncs(20, 0, controller.signal)
        if (!controller.signal.aborted) { setPage(result); setReadError(null) }
      } catch (error) { if (!controller.signal.aborted) setReadError(error) }
      if (!controller.signal.aborted) timer = setTimeout(read, 4000)
    }
    void read()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [revision])
  async function submit(event: FormEvent) {
    event.preventDefault(); if (locked.current) return
    locked.current = true; setBusy(true); setError(null)
    try { const job = await createRepositorySync(form); setCreatedId(job.syncId); setRevision(value => value+1) }
    catch (error) { setError(error) }
    finally { locked.current = false; setBusy(false) }
  }
  const update = (field: keyof typeof EMPTY, value: string) => setForm(previous => ({ ...previous, [field]: value }))
  return <section className="analysis-setup"><header className="page-heading"><div><p className="eyebrow">NEW ANALYSIS</p><h1>新建分析</h1><p className="page-intro">接入一个仓库，找到下一次审查值得关注的提交。</p></div></header>
    <form className="repository-form" onSubmit={submit}>
      <div className="form-intro"><span className="project-card-icon"><Icon name="project" size={22}/></span><div><h2>从仓库开始</h2><p>支持公开 HTTP(S) Git 仓库地址。</p></div></div>
      <label className="repository-url-label">仓库地址<input aria-label="仓库地址" autoComplete="off" required placeholder="https://github.com/owner/repository" value={form.repositoryUrl} onChange={event => update('repositoryUrl', event.target.value)}/></label>
      <details className="advanced-options"><summary><Icon name="sliders"/>分析选项 <span>分支、范围与模型策略</span></summary><div className="form-grid"><label>分支<input aria-label="分支" placeholder="默认分支" value={form.branch} onChange={event => update('branch', event.target.value)}/></label><label>提交上限<input aria-label="提交上限" type="number" min="1" max="5000" value={form.commitLimit} onChange={event => update('commitLimit', event.target.value)}/></label><label>起始日期<input aria-label="起始日期" type="date" value={form.since} onChange={event => update('since', event.target.value)}/></label><label>结束日期<input aria-label="结束日期" type="date" value={form.until} onChange={event => update('until', event.target.value)}/></label><label className="wide-field">模型策略<select aria-label="模型策略" value={form.strategy} onChange={event => update('strategy', event.target.value)}><option value="auto">自动选择</option><option value="generic-model">使用现成模型</option><option value="force-train">使用仓库数据训练</option></select></label></div></details>
      {error ? <FailureNotice error={error}/> : null}
      <div className="form-submit"><p>{form.since || form.until ? '按所选日期范围分析' : '默认分析最近 90 天'}，最多 {form.commitLimit || '500'} 个提交。</p><button className="primary-button" type="submit" disabled={busy}>{busy ? '正在创建…' : '开始分析'}<Icon name="arrow"/></button></div>
    </form>
    <section className="analysis-jobs"><div className="section-label"><h2>最近分析</h2><button className="text-button" onClick={() => setRevision(value => value+1)}>刷新</button></div>
      {readError ? <FailureNotice error={readError} onRetry={() => setRevision(value => value+1)}/> : page === null ? <LoadingNotice label="正在读取分析任务"/> : page.syncs.length === 0 ? <p className="quiet-empty">还没有分析任务。提交上方仓库地址即可开始。</p> : <div className="job-list">{page.syncs.map(job => <AnalysisJob key={job.syncId} job={job} current={createdId === job.syncId} onOpen={onOpenSync}/>)}</div>}
    </section>
  </section>
}
function AnalysisJob({ job, current, onOpen }: { job: SyncView; current: boolean; onOpen: (repositoryId: string, syncId?: string) => void }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  return <article className="analysis-job" data-current={current || undefined} aria-label={`分析任务 ${job.syncId}`}><div className="job-main"><span className={`job-status-icon ${active ? 'is-active' : job.status === 'completed' ? 'is-complete' : 'is-failed'}`}><Icon name={job.status === 'completed' ? 'check' : 'info'} size={17}/></span><div><h3>{repositoryName(job.repositoryUrl)}</h3><p>{job.branch} <span>·</span> {displayTime(job.createdAt)}</p></div><span className="job-status">{STATUS_LABELS[active ? job.stage : job.status]}</span>{job.status === 'completed' && job.repositoryId ? <button className="clear-button" onClick={() => onOpen(job.repositoryId!, job.syncId)}>查看结果<Icon name="arrow"/></button> : null}</div>
    {job.error ? <p className="job-error" role="alert">{job.error.message} 请修正上方参数后重新分析。</p> : null}
    <details className="job-details"><summary>分析详情</summary><dl><div><dt>任务</dt><dd><code>{job.syncId}</code></dd></div><div><dt>仓库</dt><dd>{job.repositoryUrl}</dd></div><div><dt>范围</dt><dd>{job.since ?? '不限'} — {job.until ?? '不限'}，最多 {job.commitLimit} 条</dd></div><div><dt>策略</dt><dd>{STRATEGY_LABELS[job.requestedStrategy]}</dd></div><div><dt>数据</dt><dd>{job.datasetVersion ?? '尚未生成'}</dd></div>{job.degradeReason ? <div><dt>模型说明</dt><dd>{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}</dl></details>
  </article>
}
