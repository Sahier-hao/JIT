/**
 * 项目总览：只回答两个问题——有哪些项目、各自处在什么状态。
 *
 * 项目本身的管理（重命名、删除）放在这一层：进入项目页只做分析相关的事。
 * 卡片整卡可点进入项目页；右上角的管理菜单负责改名与删除。
 */
import { useState } from 'react'
import { EmptyState, LoadingNotice } from '../Feedback'
import { Icon } from '../Icon'
import type { Route } from '../navigation'
import { deleteRepository, renameRepository } from '../projectClient'
import { projectStatus } from '../projectStatus'
import { useRepositories } from '../repositoryWorkspace'
import { displayTime } from '../domain'
import { ACTIVE_STATUSES } from '../repositoryContract'
import type { RepositoryView } from '../repositoryWorkspace'

export function ProjectsPage({ navigate }: { navigate: (route: Route) => void }) {
  const repositories = useRepositories()
  const [menuFor, setMenuFor] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState('')

  const items = repositories.items
  const commits = items.reduce((sum, item) => sum + item.commitCount, 0)
  const high = items.reduce((sum, item) => sum + item.distribution.high, 0)
  const running = items.filter(item => {
    const job = item.latestSync
    return job != null && (ACTIVE_STATUSES as readonly string[]).includes(job.status)
  }).length

  function reload() {
    repositories.retry()
  }

  function startRename(repo: RepositoryView) {
    setMenuFor('')
    setConfirmingId('')
    setEditorError('')
    setDraft(repo.displayName)
    setRenamingId(repo.repositoryId)
  }

  function startDelete(repo: RepositoryView) {
    setMenuFor('')
    setRenamingId('')
    setEditorError('')
    setConfirmingId(repo.repositoryId)
  }

  async function saveName(repositoryId: string) {
    if (busy) return
    setBusy(true)
    setEditorError('')
    try {
      await renameRepository(repositoryId, draft)
      setRenamingId('')
      reload()
    } catch (failure) {
      setEditorError(failure instanceof Error ? failure.message : '重命名失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeProject(repositoryId: string) {
    if (busy) return
    setBusy(true)
    setEditorError('')
    try {
      await deleteRepository(repositoryId)
      setConfirmingId('')
      reload()
    } catch (failure) {
      setEditorError(failure instanceof Error ? failure.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className="projects-page">
    <header className="page-heading">
      <div>
        <h1>项目</h1>
        <p className="page-intro">接入一个仓库，从一次分析开始安排下一次审查。</p>
      </div>
      <button className="primary-button" onClick={() => navigate({ name: 'sources' })}><Icon name="plus"/>新建项目</button>
    </header>
    {repositories.state === 'loading' && !items.length ? <LoadingNotice label="正在读取项目"/> : repositories.state === 'error' ? <EmptyState title="项目读取失败" description={repositories.error} tone="alert"><button onClick={repositories.retry}>重新加载</button></EmptyState> : items.length ? <>
      <div className="section-label"><span>全部项目</span><span>{items.length} 个项目 · {commits.toLocaleString()} 个已分析提交{high ? ` · ${high.toLocaleString()} 个高风险` : ''}{running ? ` · ${running} 个正在分析` : ''}</span></div>
      <div className="project-grid">{items.map(repo => {
        const job = repo.latestSync
        const status = projectStatus(repo, job)
        const editing = renamingId === repo.repositoryId
        const confirming = confirmingId === repo.repositoryId
        return <article className={`project-card${editing || confirming ? ' is-editing' : ''}`} key={repo.repositoryId}>
          <button className="project-card-open" onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })} aria-label={`打开项目 ${repo.displayName}`}>
            <div className="project-card-top"><span className="project-card-icon"><Icon name="project" size={23}/></span><span className={`project-card-status tone-${status.tone}`}>{status.label}</span></div>
            <h2>{repo.displayName}</h2>
            <p>{repo.url}</p>
            <div className="project-card-metrics">
              <span><b>{repo.commitCount.toLocaleString()}</b> 个已分析提交</span>
              {repo.viewSyncId ? <span><b>{repo.distribution.high.toLocaleString()}</b> 个高风险</span> : null}
            </div>
            <div className="project-card-bottom"><span>{repo.viewSyncId ? '打开项目' : '开始分析'}</span><Icon name="arrow"/></div>
            <small>最近请求 · {repo.latestSyncAt ? displayTime(repo.latestSyncAt) : '尚未分析'}</small>
          </button>
          <div className="project-card-tools">
            <button className="card-menu-button" aria-label={`管理项目 ${repo.displayName}`} aria-haspopup="menu" aria-expanded={menuFor === repo.repositoryId} onClick={() => setMenuFor(menuFor === repo.repositoryId ? '' : repo.repositoryId)}><Icon name="sliders" size={16}/></button>
            {menuFor === repo.repositoryId ? <div className="card-menu" role="menu">
              <button role="menuitem" onClick={() => startRename(repo)}>重命名</button>
              <button role="menuitem" className="danger" onClick={() => startDelete(repo)}>删除项目</button>
            </div> : null}
          </div>
          {editing ? <form className="card-editor" onSubmit={event => { event.preventDefault(); void saveName(repo.repositoryId) }}>
            <label>项目显示名<input aria-label="项目显示名" value={draft} maxLength={80} autoFocus onChange={event => setDraft(event.target.value)}/></label>
            <p className="card-editor-note">只改显示名；仓库地址与分析历史不变。</p>
            {editorError ? <p className="field-error" role="alert">{editorError}</p> : null}
            <div className="panel-actions">
              <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存名称'}</button>
              <button type="button" className="text-button" onClick={() => setRenamingId('')}>取消</button>
            </div>
          </form> : null}
          {confirming ? <div className="card-editor card-editor-danger" role="alertdialog" aria-label="确认删除项目">
            <h3>删除「{repo.displayName}」？</h3>
            <p className="card-editor-note">项目、全部分析记录与提交数据会被删除，无法恢复。仓库本身不受影响。</p>
            {editorError ? <p className="field-error" role="alert">{editorError}</p> : null}
            <div className="panel-actions">
              <button className="danger-button" disabled={busy} onClick={() => void removeProject(repo.repositoryId)}>{busy ? '正在删除…' : '确认删除'}</button>
              <button className="text-button" onClick={() => setConfirmingId('')}>取消</button>
            </div>
          </div> : null}
        </article>
      })}</div>
    </> : <div className="project-onboarding">
      <div className="onboarding-graphic" aria-hidden="true"><span/><Icon name="project" size={38}/><span/></div>
      <h2>从一个仓库开始</h2>
      <p>接入仓库后自动准备首次分析，并持续跟进新提交；结果与审查记录会一直保留。</p>
      <button className="clear-button" onClick={() => navigate({ name: 'sources' })}>新建项目 <Icon name="arrow"/></button>
      <div className="onboarding-steps"><span><b>01</b> 接入仓库</span><span><b>02</b> 自动分析</span><span><b>03</b> 安排审查</span></div>
    </div>}
  </section>
}
