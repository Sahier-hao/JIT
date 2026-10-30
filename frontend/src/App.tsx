import { lazy, Suspense, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { mantineTheme } from './lib/mantineTheme'
import { queryClient } from './lib/queryClient'
import { AppShell } from './AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Button } from './ui/controls'
import { useRoute, type Route } from './navigation'
import { useRepositories } from './repositoryWorkspace'
import { LoadingNotice, EmptyState } from './Feedback'
import { apiRequest } from './apiClient'
import { parseSync } from './repositoryContract'
import type { ReviewDraft } from './ReviewWorkbench'

// 页面按路由拆包：首屏只加载项目列表与外壳，其余工作台按需下载。
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then(module => ({ default: module.ProjectsPage })))
const ProjectPage = lazy(() => import('./pages/ProjectPage').then(module => ({ default: module.ProjectPage })))
const ReviewWorkbench = lazy(() => import('./ReviewWorkbench').then(module => ({ default: module.ReviewWorkbench })))
const AdminWorkspace = lazy(() => import('./pages/AdminWorkspace').then(module => ({ default: module.AdminWorkspace })))
const AnalysisComparison = lazy(() => import('./pages/AnalysisComparison').then(module => ({ default: module.AnalysisComparison })))
const PullRequestWork = lazy(() => import('./pages/PullRequestJourney').then(module => ({ default: module.PullRequestWork })))
const FixedPRSnapshot = lazy(() => import('./pages/PullRequestJourney').then(module => ({ default: module.FixedPRSnapshot })))
const ProjectEvents = lazy(() => import('./components/ProjectActivity').then(module => ({ default: module.ProjectEvents })))

export default function App() {
  const [router] = useState(() => createHashRouter([{ path: '*', element: <Workspace/> }]))
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'charcoal')
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'charcoal'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return <MantineProvider theme={mantineTheme} forceColorScheme={dark ? 'dark' : 'light'} env={import.meta.env.MODE === 'test' ? 'test' : undefined}>
    <QueryClientProvider client={queryClient}><RouterProvider router={router}/></QueryClientProvider>
  </MantineProvider>
}

function Workspace() {
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
  else if (route.name === 'retired' || route.name === 'unknown') content = <EmptyState title={route.name === 'retired' ? '这个入口已移除' : '没有找到这个页面'} description={route.name === 'retired' ? '独立工具页面已撤下。请从项目开始分析；已保存的数据仍然保留。' : '请核对地址，或返回项目继续。'}><Button variant="primary" onClick={() => navigate({ name: 'repositories' })}>返回项目</Button></EmptyState>
  else content = <ProjectsPage navigate={navigate}/>
  return <AppShell route={route} navigate={navigate} repositories={repositories.items}><ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}>{content}</Suspense></ErrorBoundary></AppShell>
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
