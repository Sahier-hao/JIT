/**
 * 项目总览：只回答两个问题——有哪些项目、各自处在什么状态。
 *
 * 项目本身的管理（重命名、删除）放在这一层：进入项目页只做分析相关的事。
 * 卡片整卡可点进入项目页；右上角的管理菜单负责改名与删除。
 */
import { useEffect, useState } from 'react'
import { Button, IconButton, Input } from '../ui/controls'
import { Dropdown } from '../ui/dropdown'
import { PageHeader, TabBar } from '../ui/layout'
import { EmptyState, LoadingNotice } from '../Feedback'
import { Icon } from '../Icon'
import { repositoryRoute, type Route } from '../navigation'
import { deleteRepository, renameRepository } from '../projectClient'
import { projectStatus, type ProjectTone } from '../projectStatus'
import { useRepositories } from '../repositoryWorkspace'
import { displayTime } from '../domain'
import { ACTIVE_STATUSES } from '../repositoryContract'
import { PersonalWorks } from '../components/PersonalWorks'
import { NewProjectDialog } from '../components/NewProjectDialog'
import type { RepositoryView } from '../repositoryWorkspace'
import { cn } from '../lib/utils'

const TONE_DOT: Record<ProjectTone, string> = {
  active: 'bg-blue',
  ok: 'bg-teal',
  alert: 'bg-rose',
  muted: 'bg-foreground-4',
}

export function ProjectsPage({ navigate, view = 'projects', createOpen = false }: { navigate: (route: Route, replace?: boolean) => void; view?: 'projects' | 'reviews'; createOpen?: boolean }) {
  const repositories = useRepositories()
  const [menuFor, setMenuFor] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [draft, setDraft] = useState('')
  const [confirmingId, setConfirmingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [editorError, setEditorError] = useState('')
  const [creating, setCreating] = useState(Boolean(createOpen))
  useEffect(() => { setCreating(Boolean(createOpen)) }, [createOpen])

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

  return <section className="grid gap-4">
    <PageHeader
      title={view === 'reviews' ? '我的审查' : '项目'}
      description={view === 'reviews' ? '草稿只保存在当前浏览器。' : undefined}
      actions={view === 'projects' ? <Button aria-label="新建项目" variant="primary" icon={<Icon name="plus" size={15}/>} onClick={() => setCreating(true)}>新建项目</Button> : undefined}
    />

    <TabBar
      label="项目与个人工作"
      value={view}
      onChange={next => navigate({ name: next === 'projects' ? 'repositories' : 'my-reviews' })}
      items={[{ value: 'projects', label: '项目' }, { value: 'reviews', label: '我的审查' }]}
    />

    {view === 'reviews' ? <PersonalWorks navigate={navigate}/> : <>
      {repositories.state === 'loading' && !items.length ? <LoadingNotice label="正在读取项目"/> : repositories.state === 'error' ? <EmptyState title="项目读取失败" description={repositories.error} tone="alert"><Button onClick={repositories.retry}>重新加载</Button></EmptyState> : items.length ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-foreground-3">
          <span className="text-sm font-medium text-foreground-2">全部项目</span>
          <span>{items.length} 个项目 · {commits.toLocaleString()} 个已分析提交{high ? ` · ${high.toLocaleString()} 个高风险` : ''}{running ? ` · ${running} 个正在分析` : ''}</span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">{items.map(repo => {
          const job = repo.latestSync
          const status = projectStatus(repo, job)
          const editing = renamingId === repo.repositoryId
          const confirming = confirmingId === repo.repositoryId
          return <article className={cn('relative rounded-md border bg-card p-card', editing || confirming ? 'border-accent' : 'border-border-soft')} key={repo.repositoryId}>
            <button type="button" className="block w-full border-0 bg-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => navigate(repositoryRoute(repo.repositoryId))} aria-label={`打开项目 ${repo.displayName}`}>
              <div className="flex items-center justify-between gap-2 pr-10">
                <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border-soft bg-sunken text-foreground-2"><Icon name="project" size={20}/></span>
                <span className="inline-flex items-center gap-1.5 text-xs text-foreground-3"><span className={cn('size-1.5 rounded-full', TONE_DOT[status.tone])}/>{status.label}</span>
              </div>
              <h2 className="mt-3 truncate text-base font-semibold text-foreground">{repo.displayName}</h2>
              <p className="mt-1 truncate text-xs text-foreground-3">{repo.url}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-3">
                <span><b className="text-sm font-semibold text-foreground">{repo.commitCount.toLocaleString()}</b> 个已分析提交</span>
                {repo.viewSyncId ? <span><b className="text-sm font-semibold text-foreground">{repo.distribution.high.toLocaleString()}</b> 个高风险</span> : null}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border-soft pt-3 text-xs text-foreground-2"><span>打开项目</span><Icon name="arrow" size={14}/></div>
              <small className="mt-2 block text-xs text-foreground-4">最近请求 · {repo.latestSyncAt ? displayTime(repo.latestSyncAt) : '尚未分析'}</small>
            </button>
            <div className="absolute right-2 top-2">
              <Dropdown open={menuFor === repo.repositoryId} onOpenChange={open => setMenuFor(open ? repo.repositoryId : '')} items={[{ key: 'rename', label: '重命名' }, { key: 'delete', label: '删除项目', danger: true }]} onClick={key => { if (key === 'rename') startRename(repo); else startDelete(repo) }}>
                <IconButton label={`管理项目 ${repo.displayName}`} icon={<Icon name="settings" size={16}/>}/>
              </Dropdown>
            </div>
            {editing ? <form className="mt-4 grid gap-2.5 border-t border-border-soft pt-4" onSubmit={event => { event.preventDefault(); void saveName(repo.repositoryId) }}>
              <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">项目显示名</span><Input aria-label="项目显示名" value={draft} maxLength={80} autoFocus onChange={event => setDraft(event.target.value)}/></label>
              {editorError ? <p className="text-xs text-rose" role="alert">{editorError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" type="submit" loading={busy}>{busy ? '正在保存…' : '保存名称'}</Button>
                <Button onClick={() => setRenamingId('')}>取消</Button>
              </div>
            </form> : null}
            {confirming ? <div className="mt-4 grid gap-2.5 rounded-sm border border-rose/30 bg-rose-soft p-3" role="alertdialog" aria-label="确认删除项目">
              <h3 className="text-sm font-semibold text-rose-deep">删除「{repo.displayName}」？</h3>
              <p className="text-xs leading-body text-foreground-2">项目、全部分析记录与提交数据会被删除，无法恢复。仓库本身不受影响。</p>
              {editorError ? <p className="text-xs text-rose" role="alert">{editorError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button danger loading={busy} onClick={() => void removeProject(repo.repositoryId)}>{busy ? '正在删除…' : '确认删除'}</Button>
                <Button onClick={() => setConfirmingId('')}>取消</Button>
              </div>
            </div> : null}
          </article>
        })}</div>
      </> : <div className="grid justify-items-center gap-4 rounded-lg border border-border bg-card px-6 py-14 text-center">
        <div className="flex items-center gap-4 text-accent" aria-hidden="true"><span className="h-px w-12 bg-border-strong"/><Icon name="project" size={44} className="rounded-xl border border-border-strong bg-card p-4"/><span className="h-px w-12 bg-border-strong"/></div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">从一个仓库开始</h2>
        <p className="max-w-md text-sm leading-body text-foreground-3">接入仓库后自动准备首次分析，并持续跟进新提交；结果与审查记录会一直保留。</p>
        <Button aria-label="新建项目" variant="primary" size="lg" icon={<Icon name="plus" size={15}/>} onClick={() => setCreating(true)}>新建项目</Button>
        <div className="mt-2 flex flex-wrap justify-center gap-6 border-t border-border-soft pt-4 text-xs text-foreground-3">
          <span><b className="mr-1.5 font-mono text-foreground">01</b>接入仓库</span>
          <span><b className="mr-1.5 font-mono text-foreground">02</b>自动分析</span>
          <span><b className="mr-1.5 font-mono text-foreground">03</b>安排审查</span>
        </div>
      </div>}
    </>}

    <NewProjectDialog open={creating} onOpenChange={next => { setCreating(next); if (!next && createOpen) navigate({ name: 'repositories' }, true) }} navigate={navigate}/>
  </section>
}
