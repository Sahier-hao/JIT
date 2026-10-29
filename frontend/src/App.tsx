import { useEffect, useState } from 'react'
import { AppShell } from './AppShell'
import { useRoute, type Route } from './navigation'
import { useRepositories } from './repositoryWorkspace'
import { ReviewWorkbench, type ReviewDraft } from './ReviewWorkbench'
import { AdminWorkspace } from './pages/AdminWorkspace'
import { LoadingNotice, EmptyState } from './Feedback'
import { apiRequest } from './apiClient'
import { parseSync } from './repositoryContract'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectPage } from './pages/ProjectPage'
import { AnalysisComparison } from './pages/AnalysisComparison'
import { PullRequestWork, FixedPRSnapshot } from './pages/PullRequestJourney'
import { ProjectEvents } from './components/ProjectActivity'

export default function App() {
  const { route, navigate } = useRoute()
  const repositories = useRepositories()
  const [drafts] = useState(() => new Map<string, ReviewDraft>())
  const stateKey = route.name === 'analysis' ? `${route.repositoryId}:${route.viewSyncId}` : ''
  let content
  if (route.name === 'my-reviews') content = <ProjectsPage navigate={navigate} view="reviews"/>
  else if (route.name === 'pr-work') content = route.snapshotId ? <FixedPRSnapshot key={`${route.repositoryId ?? ''}:${route.snapshotId}`} owner={route.owner} repositoryName={route.repositoryName} number={route.number} repositoryId={route.repositoryId} snapshotId={route.snapshotId} navigate={navigate}/> : <PullRequestWork key={`${route.repositoryId ?? ''}:${route.owner}/${route.repositoryName}/${route.number}`} owner={route.owner} repositoryName={route.repositoryName} number={route.number} repositoryId={route.repositoryId} navigate={navigate}/>
  else if (route.name === 'notifications') content = <ProjectEvents navigate={navigate}/>
  else if (route.name === 'sources') content = <ProjectsPage navigate={navigate} createOpen/>
  else if (route.name === 'repository') content = <ProjectPage key={route.repositoryId} repositoryId={route.repositoryId} tab={route.tab} viewId={route.viewId} navigate={navigate}/>
  else if (route.name === 'comparison') content = <AnalysisComparison key={`${route.repositoryId}:${route.baseSyncId}:${route.targetSyncId}`} repositoryId={route.repositoryId} baseSyncId={route.baseSyncId} targetSyncId={route.targetSyncId} navigate={navigate}/>
  else if (route.name === 'analysis') content = <ReviewWorkbench key={stateKey} repositoryId={route.repositoryId} viewSyncId={route.viewSyncId} commitId={route.commitId} stateKey={stateKey} drafts={drafts} navigate={navigate}/>
  else if (route.name === 'report' || route.name === 'admin') content = <AdminWorkspace route={route} navigate={navigate}/>
  else if (route.name === 'legacy-sync') content = <LegacySync key={route.syncId} route={route} navigate={navigate}/>
  else if (route.name === 'retired' || route.name === 'unknown') content = <EmptyState title={route.name === 'retired' ? '这个入口已移除' : '没有找到这个页面'} description={route.name === 'retired' ? '独立工具页面已撤下。请从项目开始分析；已保存的数据仍然保留。' : '请核对地址，或返回项目继续。'}><button className="primary-button" onClick={() => navigate({ name: 'repositories' })}>返回项目</button></EmptyState>
  else content = <ProjectsPage navigate={navigate}/>
  return <AppShell route={route} navigate={navigate} repositories={repositories.items}>{content}</AppShell>
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
  return error ? <EmptyState title="分析不可用" description={error}><button onClick={() => navigate({ name: 'repositories' })}>返回项目</button></EmptyState> : <LoadingNotice label="正在读取原分析"/>
}
