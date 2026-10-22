/**
 * 项目页：一个项目的全部操作都收在这一页。
 *
 * 顺序按使用频率排：先看「当前分析结果」，再决定是否发起新分析，最后才是分析记录。
 * 「当前结果」严格指项目可用于审查的那次成功分析；最近一次尝试可能还在跑或已失败，
 * 两者分开显示，避免一次失败把上一次成功的结果一起弄丢。
 */
import { useState } from 'react'
import { createRepositorySync } from '../apiClient'
import { AnalysisForm } from '../components/AnalysisForm'
import { EmptyState, FailureNotice, LoadingNotice } from '../Feedback'
import { Icon } from '../Icon'
import type { Route } from '../navigation'
import { deleteRepositorySync, selectRepositoryView, useRepositorySyncs } from '../projectClient'
import { projectStatus } from '../projectStatus'
import { ACTIVE_STATUSES, DEGRADE_LABELS, STATUS_LABELS, STRATEGY_LABELS, type SyncView } from '../repositoryContract'
import { useRepository } from '../repositoryWorkspace'
import { displayTime } from '../domain'

export function ProjectPage({ repositoryId, navigate }: { repositoryId: string; navigate: (route: Route, replace?: boolean) => void }) {
  const detail = useRepository(repositoryId)
  const records = useRepositorySyncs(repositoryId, 10, 0)
  const [recordError, setRecordError] = useState('')
  const [selectingId, setSelectingId] = useState('')

  if (detail.state === 'loading' && !detail.repository) return <LoadingNotice label="正在读取项目"/>
  if (detail.state === 'error' || !detail.repository) {
    return <EmptyState title="项目读取失败" description={detail.error} tone="alert"><button onClick={detail.retry}>重新加载</button><button onClick={() => navigate({ name: 'repositories' })}>返回项目列表</button></EmptyState>
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
    if (recordError !== '') setRecordError('')
    try {
      await deleteRepositorySync(job.syncId)
      records.retry()
      detail.retry()
    } catch (failure) {
      setRecordError(failure instanceof Error ? failure.message : '删除分析记录失败')
    }
  }
  function retryRecord(job: SyncView) {
    createRepositorySync({
      repositoryUrl: repository.url,
      branch: job.branch,
      since: job.since ?? '',
      until: job.until ?? '',
      commitLimit: String(job.commitLimit),
      strategy: job.requestedStrategy,
    }).then(() => { records.retry(); detail.retry() }).catch((failure: unknown) => setRecordError(failure instanceof Error ? failure.message : '重新发起失败'))
  }

  return <section className="project-page">
    <button className="back-link" onClick={() => navigate({ name: 'repositories' })}><Icon name="collapse" size={16}/>全部项目</button>
    <header className="page-heading project-heading">
      <div>
        <h1>{repository.displayName}</h1>
        <p className="project-url">{repository.url}</p>
        <p className="page-intro">{repository.defaultBranch || '默认分支'} · {repository.commitCount.toLocaleString()} 个已分析提交 · 建立于 {displayTime(repository.createdAt)}</p>
        <p className={`status-line tone-${status.tone}`} role="status">{status.label}</p>
      </div>
      <div className="page-actions">
        {context ? <button className="primary-button" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: context.syncId, view: 'commits' })}>打开审查<Icon name="arrow"/></button> : null}
      </div>
    </header>

    <section className="project-start" aria-label="发起分析">
      <div className="section-label"><h2>发起分析</h2><span>不会覆盖当前结果</span></div>
      <AnalysisForm repositoryUrl={repository.url} defaultBranch={repository.defaultBranch} onStarted={() => { records.retry(); detail.retry() }}/>
    </section>

    <section className="project-result" aria-label="当前分析结果">
      <div className="section-label"><h2>当前分析结果</h2>{context ? <span>完成于 {context.completedAt ? displayTime(context.completedAt) : '未记录'}</span> : null}</div>
      {context ? <div className="result-panel">
        <div className="result-stats">
          <div><b>{repository.commitCount.toLocaleString()}</b><span>已分析提交</span></div>
          <div className="high"><b>{repository.distribution.high.toLocaleString()}</b><span>高风险</span></div>
          <div><b>{repository.distribution.medium.toLocaleString()}</b><span>中风险</span></div>
          <div><b>{repository.distribution.low.toLocaleString()}</b><span>低风险</span></div>
        </div>
        <dl className="result-facts">
          <div><dt>数据版本</dt><dd>{context.datasetVersion ?? '未登记'}</dd></div>
          <div><dt>分支</dt><dd>{context.branch}</dd></div>
          <div><dt>模型策略</dt><dd>{repository.modelStrategy === 'generic-model' ? '现成模型' : repository.modelStrategy === 'repository-trained' ? '本仓库数据训练' : '未记录'}</dd></div>
          {repository.degradeReason ? <div><dt>说明</dt><dd>{DEGRADE_LABELS[repository.degradeReason] ?? repository.degradeReason}</dd></div> : null}
        </dl>
        <div className="panel-actions">
          <button className="primary-button" onClick={() => navigate({ name: 'analysis', repositoryId, viewSyncId: context.syncId, view: 'commits' })}>查看提交与审查计划<Icon name="arrow"/></button>
        </div>
      </div> : <div className="result-empty">
        <p>还没有可用的分析结果。{latest?.status === 'failed' ? '最近一次分析失败，修正后重新发起。' : latest && (ACTIVE_STATUSES as readonly string[]).includes(latest.status) ? '分析进行中，完成后这里会出现结果。' : ''}</p>
      </div>}
    </section>

    <section className="project-records" aria-label="分析记录">
      <div className="section-label"><h2>分析记录</h2><span>{records.state === 'ready' ? `${records.total} 条` : ''}</span></div>
      {recordError ? <p className="field-error" role="alert">{recordError}</p> : null}
      {records.state === 'loading' && records.syncs.length === 0 ? <LoadingNotice label="正在读取分析记录"/> : records.state === 'error' ? <FailureNotice error={records.error} onRetry={records.retry}/> : records.syncs.length === 0 ? <p className="quiet-empty">还没有分析记录。设置范围后开始第一次分析。</p> : <div className="job-list">{records.syncs.map(job => <RecordRow key={job.syncId} job={job} current={job.syncId === context?.syncId} selecting={selectingId === job.syncId} onOpen={() => navigate({ name: 'analysis', repositoryId, viewSyncId: job.syncId, view: 'commits' })} onSelect={() => void makeCurrent(job)} onDelete={() => void removeRecord(job)} onRetry={() => retryRecord(job)}/>) }</div>}
    </section>
  </section>
}

function RecordRow({ job, current, selecting, onOpen, onSelect, onDelete, onRetry }: { job: SyncView; current: boolean; selecting: boolean; onOpen: () => void; onSelect: () => void; onDelete: () => void; onRetry: () => void }) {
  const active = (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  const completed = job.status === 'completed'
  const title = completed && current ? '当前结果' : STATUS_LABELS[active ? job.stage : job.status]
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
        {completed ? <button className="text-button" onClick={onOpen}>打开结果</button> : null}
        {!active && !completed ? <button className="text-button" onClick={onRetry}>用这些参数重试</button> : null}
        {!active ? <button className="text-button danger" onClick={onDelete}>删除记录</button> : null}
      </div>
    </div>
    {job.error ? <p className="job-error" role="alert">{job.error.message} 请修正后重新分析。</p> : null}
    <details className="job-details"><summary>分析详情</summary><dl>
      <div><dt>范围</dt><dd>{job.since ?? '不限'} — {job.until ?? '不限'}，最多 {job.commitLimit} 条</dd></div>
      <div><dt>分支</dt><dd>{job.branch}</dd></div>
      <div><dt>数据</dt><dd>{job.datasetVersion ?? '尚未生成'}</dd></div>
      {job.degradeReason ? <div><dt>模型说明</dt><dd>{DEGRADE_LABELS[job.degradeReason] ?? job.degradeReason}</dd></div> : null}
      {job.requestId ? <div><dt>请求标识</dt><dd><code>{job.requestId}</code></dd></div> : null}
    </dl></details>
  </article>
}
