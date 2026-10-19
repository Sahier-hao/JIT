import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './AppShell'
import { useRoute, type Route } from './navigation'
import { useRepositories, useRepository } from './repositoryWorkspace'
import { ReviewWorkbench, type ReviewDraft } from './ReviewWorkbench'
import { RepositorySourcesPage } from './RepositorySourcesPage'
import { VerificationReport } from './VerificationReport'
import { LoadingNotice, EmptyState } from './Feedback'
import { Icon } from './Icon'
import { apiRequest } from './apiClient'
import { parseSync } from './repositoryContract'
import { displayTime } from './domain'

export default function App() {
  const { route, navigate } = useRoute()
  const repositories = useRepositories()
  const [drafts] = useState(() => new Map<string, ReviewDraft>())
  const [recentAnalysis, setRecentAnalysis] = useState<Extract<Route, { name: 'analysis' }> | null>(null)
  const [selections, setSelections] = useState<Record<string, { ids: string[]; warning: string | null }>>({})
  const stateKey = route.name === 'analysis' ? `${route.repositoryId}:${route.viewSyncId}` : ''
  const onSelection = useCallback((selection: { ids: string[]; warning: string | null }) => setSelections(previous => ({ ...previous, [stateKey]: selection })), [stateKey])
  const confirmed = useCallback((target: Route) => { if (target.name === 'analysis') setRecentAnalysis(target) }, [])
  let content
  if (route.name === 'sources') content = <RepositorySourcesPage onOpenSync={(repositoryId, syncId) => { repositories.retry(); navigate(syncId ? { name: 'analysis', repositoryId, viewSyncId: syncId, view: 'commits' } : { name: 'repository', repositoryId }) }}/>
  else if (route.name === 'repository') content = <RepositoryResolver key={route.repositoryId} repositoryId={route.repositoryId} navigate={navigate}/>
  else if (route.name === 'analysis') content = <ReviewWorkbench key={stateKey} repositoryId={route.repositoryId} viewSyncId={route.viewSyncId} commitId={route.commitId} stateKey={stateKey} drafts={drafts} view={route.view === 'plan' ? 'shortlist' : 'list'} navigate={navigate} selection={selections[stateKey] ?? { ids: [], warning: null }} onSelection={onSelection} onConfirmed={confirmed}/>
  else if (route.name === 'report') content = <VerificationReport route={route} navigate={navigate}/>
  else if (route.name === 'legacy-sync') content = <LegacySync key={route.syncId} route={route} navigate={navigate}/>
  else if (route.name === 'retired' || route.name === 'unknown') content = <EmptyState title={route.name === 'retired' ? '这个入口已移除' : '没有找到这个页面'} description={route.name === 'retired' ? '独立工具页面已撤下。请从项目开始分析；已保存的数据仍然保留。' : '请核对地址，或返回项目继续。'}><button className="primary-button" onClick={() => navigate({ name: 'repositories' })}>返回项目</button></EmptyState>
  else content = <section className="projects-page"><header className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>项目</h1><p className="page-intro">从一次分析开始，把审查精力放在值得关注的改动上。</p></div><button className="primary-button" onClick={() => navigate({ name: 'sources' })}><Icon name="plus"/>新建分析</button></header>
    {repositories.state === 'loading' ? <LoadingNotice label="正在读取项目"/> : repositories.state === 'error' ? <EmptyState title="项目读取失败" description={repositories.error} tone="alert"><button onClick={repositories.retry}>重新加载</button></EmptyState> : repositories.items.length ? <><div className="section-label"><span>全部项目</span><span>{repositories.total} 个项目</span></div><div className="project-grid">{repositories.items.map(repo => <button className="project-card" key={repo.repositoryId} onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })}><div className="project-card-top"><span className="project-card-icon"><Icon name="project" size={23}/></span><span className="project-card-status">{repo.viewSyncId ? '已有分析' : '等待分析'}</span></div><h2>{repo.displayName}</h2><p>{repo.url}</p><div className="project-card-bottom"><span><b>{repo.commitCount.toLocaleString()}</b> 个已分析提交</span><Icon name="arrow"/></div><small>最近请求 · {repo.latestSyncAt ? displayTime(repo.latestSyncAt) : '尚未发起'}</small></button>)}</div></> : <div className="project-onboarding"><div className="onboarding-graphic" aria-hidden="true"><span/><Icon name="project" size={38}/><span/></div><p className="eyebrow">A CLEARER CODE REVIEW</p><h2>从一个仓库开始</h2><p>接入项目，分析提交，再决定下一次审查的重点。</p><button className="clear-button" onClick={() => navigate({ name: 'sources' })}>接入仓库 <Icon name="arrow"/></button><div className="onboarding-steps"><span><b>01</b> 接入项目</span><span><b>02</b> 分析提交</span><span><b>03</b> 安排审查</span></div></div>}
  </section>
  return <AppShell route={route} navigate={navigate} repositories={repositories.items} recentAnalysis={recentAnalysis}>{content}</AppShell>
}
function RepositoryResolver({ repositoryId, navigate }: { repositoryId: string; navigate: (route: Route, replace?: boolean) => void }) {
  const result = useRepository(repositoryId)
  useEffect(() => { if (result.state === 'ready' && result.repository?.viewContext) navigate({ name: 'analysis', repositoryId, viewSyncId: result.repository.viewContext.syncId, view: 'commits' }, true) }, [result.state, result.repository, repositoryId, navigate])
  if (result.state === 'error') return <EmptyState tone="alert" title="项目读取失败" description={result.error}><button onClick={result.retry}>重新加载</button></EmptyState>
  if (result.state === 'ready' && !result.repository?.viewContext) return <EmptyState title="项目还没有成功分析" description={result.repository?.latestSync?.error?.message ?? '完成一次分析后，即可查看提交。'}><button className="primary-button" onClick={() => navigate({ name: 'sources' })}>查看分析任务</button></EmptyState>
  return <LoadingNotice label="正在定位分析结果"/>
}
function LegacySync({ route, navigate }: { route: Extract<Route, { name: 'legacy-sync' }>; navigate: (route: Route, replace?: boolean) => void }) {
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    apiRequest({ path: `/api/v1/repository-syncs/${encodeURIComponent(route.syncId)}`, method: 'GET', signal: controller.signal }).then(parseSync).then(job => {
      if (controller.signal.aborted) return
      if (job.syncId !== route.syncId || !job.repositoryId || job.status !== 'completed') throw new Error('该作业尚无成功分析结果。')
      navigate({ name: 'analysis', repositoryId: job.repositoryId, viewSyncId: job.syncId, view: route.view }, true)
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '分析读取失败') })
    return () => controller.abort()
  }, [route.syncId, route.view, navigate])
  return error ? <EmptyState title="分析不可用" description={error}><button onClick={() => navigate({ name: 'sources' })}>查看分析任务</button></EmptyState> : <LoadingNotice label="正在读取原分析"/>
}
