import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { lazy, Suspense, useEffect, useState } from 'react'
import { createHashRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

import { analysisRoute, hashFor, useRoute, type Route } from '@/app/navigation'
import { ROUTES } from '@/app/routeTable'
import { useUserSession } from '@/features/account/userClient'
import { ReviewAccountProvider, type ReviewAccountStatus } from '@/features/reviews/reviewAccount'
import { useRepositories } from '@/features/projects/repositoryWorkspace'
import { LoadingNotice, EmptyState } from '@/components/shared/Feedback'
import { apiRequest } from '@/lib/apiClient'
import { parseSync } from '@/features/projects/repositoryContract'
import type { ReviewDraft } from '@/features/reviews/ReviewWorkbench'
import { requestLogin } from '@/features/account/components/UserAccount'

// 页面按路由拆包：首屏只加载项目列表与外壳，其余工作台按需下载。
const ProjectsPage = lazy(() => import('@/features/projects/pages/ProjectsPage').then(module => ({ default: module.ProjectsPage })))
const PersonalWorks = lazy(() => import('@/features/reviews/components/PersonalWorks').then(module => ({ default: module.PersonalWorks })))
const ProjectPage = lazy(() => import('@/features/projects/pages/ProjectPage').then(module => ({ default: module.ProjectPage })))
const ReviewWorkbench = lazy(() => import('@/features/reviews/ReviewWorkbench').then(module => ({ default: module.ReviewWorkbench })))
const AdminWorkspace = lazy(() => import('@/features/admin/AdminWorkspace').then(module => ({ default: module.AdminWorkspace })))
const AnalysisComparison = lazy(() => import('@/features/research/pages/AnalysisComparison').then(module => ({ default: module.AnalysisComparison })))
const PullRequestWork = lazy(() => import('@/features/reviews/pages/PullRequestJourney').then(module => ({ default: module.PullRequestWork })))
const FixedPRSnapshot = lazy(() => import('@/features/reviews/pages/PullRequestJourney').then(module => ({ default: module.FixedPRSnapshot })))
const ProjectEvents = lazy(() => import('@/features/projects/components/ProjectActivity').then(module => ({ default: module.ProjectEvents })))
const MyDataPage = lazy(() => import('@/features/datasets/pages/MyDataPage').then(module => ({ default: module.MyDataPage })))
const MyTrainingPage = lazy(() => import('@/features/training/pages/MyTrainingPage').then(module => ({ default: module.MyTrainingPage })))
const AlgorithmLibraryPage = lazy(() => import('@/features/training/pages/AlgorithmLibraryPage').then(module => ({ default: module.AlgorithmLibraryPage })))
const MyModelsPage = lazy(() => import('@/features/models/pages/MyModelsPage').then(module => ({ default: module.MyModelsPage })))
const MyPredictionsPage = lazy(() => import('@/features/predictions/pages/MyPredictionsPage').then(module => ({ default: module.MyPredictionsPage })))
const ModelEvaluationPage = lazy(() => import('@/features/evaluation/pages/ModelEvaluationPage').then(module => ({ default: module.ModelEvaluationPage })))
const LandingPage = lazy(() => import('@/features/account/pages/LandingPage').then(module => ({ default: module.LandingPage })))
const LoginPage = lazy(() => import('@/features/account/pages/LoginPage').then(module => ({ default: module.LoginPage })))
const LineResearchPage = lazy(() => import('@/features/research/pages/LineResearchPage').then(module => ({ default: module.LineResearchPage })))
const VSCodePluginPage = lazy(() => import('@/features/plugins/pages/VSCodePluginPage').then(module => ({ default: module.VSCodePluginPage })))

export default function App() {
  const [router] = useState(() => createHashRouter([{
    element: <Workspace/>,
    children: ROUTES.map(route => ({ ...route, element: <Outlet/> })),
  }]))
  return <QueryClientProvider client={queryClient}><TooltipProvider delayDuration={200}><RouterProvider router={router}/></TooltipProvider></QueryClientProvider>
}

function Workspace() {
  const { route, navigate } = useRoute()
  const { session, setSession, generation, verifying } = useUserSession()
  const administrative = route.name === 'admin' || route.name === 'report'
  const repositories = useRepositories(session?.authenticated === true && !administrative && route.name !== 'landing' && route.name !== 'login')
  const account = session?.authenticated ? session.username : null
  const accountStatus: ReviewAccountStatus = session === null || verifying ? 'verifying' : session.status
  const accountValue = { status: accountStatus, account, generation }
  const [drafts] = useState(() => new Map<string, ReviewDraft>())
  const stateKey = route.name === 'analysis' ? `${route.repositoryId}:${route.viewSyncId}` : ''
  if (route.name === 'landing') {
    return <ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}><LandingPage navigate={navigate} session={session}/></Suspense></ErrorBoundary>
  }
  if (route.name === 'login') {
    return <ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}><LoginPage route={route} session={session} navigate={navigate} onUser={setSession}/></Suspense></ErrorBoundary>
  }
  // 研究预览是公开的独立页面，不属于用户工作区，也不参与项目分析。
  if (route.name === 'research-line') {
    return <ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}><LineResearchPage navigate={navigate}/></Suspense></ErrorBoundary>
  }
  // 管理工作区是独立外壳：管理员会话由管理工作区自行校验，未登录时返回登录页。
  if (route.name === 'admin' || route.name === 'report') {
    return <ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}><AdminWorkspace route={route} navigate={navigate}/></Suspense></ErrorBoundary>
  }
  if (session === null) return <div className="workspace-boot"><LoadingNotice label="正在确认登录状态"/></div>
  if (!session.authenticated) {
    return <ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}>
      <LoginPage route={{ name: 'login', role: 'user', next: hashFor(route) }} session={session} navigate={navigate} onUser={setSession}/>
    </Suspense></ErrorBoundary>
  }
  if (route.name === 'repository' && route.buildTaskId) {
    const target = hashFor({ name: 'my-data', view: 'builds', buildProjectId: route.repositoryId, taskId: route.buildTaskId })
    return <Navigate to={target.slice(1)} replace/>
  }
  let content
  if (route.name === 'my-reviews') content = <PersonalWorks key={`${account ?? ''}:reviews`} navigate={navigate}/>
  else if (route.name === 'pr-work') content = route.snapshotId ? <FixedPRSnapshot key={`${account ?? ''}:${route.repositoryId ?? ''}:${route.snapshotId}`} owner={route.owner} repositoryName={route.repositoryName} number={route.number} repositoryId={route.repositoryId} snapshotId={route.snapshotId} navigate={navigate}/> : <PullRequestWork key={`${account ?? ''}:${route.repositoryId ?? ''}:${route.owner}/${route.repositoryName}/${route.number}`} owner={route.owner} repositoryName={route.repositoryName} number={route.number} repositoryId={route.repositoryId} preview={route.mode === 'preview'} navigate={navigate}/>
  else if (route.name === 'notifications') content = <ProjectEvents navigate={navigate}/>
  else if (route.name === 'my-data') content = <MyDataPage key={account} account={session.username} navigate={navigate} onLoginRequired={requestLogin}
    initialDatasetVersion={route.datasetVersion} initialTab={route.view === 'builds' ? 'builds' : undefined} initialTaskId={route.view !== 'imports' ? route.taskId : undefined}
    importHistory={route.view === 'imports'} importTaskId={route.view === 'imports' ? route.taskId : undefined} buildProjectId={route.buildProjectId}/>
  else if (route.name === 'my-training') content = <MyTrainingPage key={`${account}:${route.experimentId ?? 'list'}:${route.datasetVersion ?? ''}:${route.method ?? ''}:${route.schema ?? ''}`} account={account} experimentId={route.experimentId} initialDatasetVersion={route.datasetVersion} initialMethod={route.method} initialSchema={route.schema} historyDatasetVersion={route.historyDatasetVersion} navigate={navigate} onLoginRequired={requestLogin}/>
  else if (route.name === 'algorithms') content = <AlgorithmLibraryPage method={route.method} navigate={navigate} onLoginRequired={requestLogin}/>
  else if (route.name === 'ide-plugin') content = <VSCodePluginPage/>
  else if (route.name === 'my-models') content = <MyModelsPage navigate={navigate} onLoginRequired={requestLogin}/>
  else if (route.name === 'my-predictions') content = <MyPredictionsPage key={`${route.batchId ?? 'new'}:${route.datasetVersion ?? ''}`} batchId={route.batchId} initialDatasetVersion={route.datasetVersion} navigate={navigate} onLoginRequired={requestLogin}/>
  else if (route.name === 'model-evaluation') content = <ModelEvaluationPage key={`${route.source ?? 'none'}:${route.experimentId ?? ''}:${route.taskId ?? ''}:${route.batchId ?? ''}`} source={route.source} experimentId={route.experimentId} taskId={route.taskId} modelId={route.modelId} batchId={route.batchId} navigate={navigate} onLoginRequired={requestLogin}/>
  else if (route.name === 'profile') content = <ProjectsPage navigate={navigate}/>
  else if (route.name === 'sources') content = <ProjectsPage navigate={navigate} createOpen/>
  else if (route.name === 'repository') content = <ProjectPage key={route.repositoryId} repositoryId={route.repositoryId} tab={route.tab} viewId={route.viewId} navigate={navigate}/>
  else if (route.name === 'comparison') content = <AnalysisComparison key={`${route.repositoryId}:${route.baseSyncId}:${route.targetSyncId}`} repositoryId={route.repositoryId} baseSyncId={route.baseSyncId} targetSyncId={route.targetSyncId} navigate={navigate}/>
  else if (route.name === 'analysis') content = <ReviewWorkbench key={stateKey} repositoryId={route.repositoryId} viewSyncId={route.viewSyncId} commitId={route.commitId} stateKey={stateKey} drafts={drafts} navigate={navigate}/>
  else if (route.name === 'legacy-sync') content = <LegacySync key={route.syncId} route={route} navigate={navigate}/>
  else if (route.name === 'retired' || route.name === 'unknown') content = <EmptyState title={route.name === 'retired' ? '这个入口已移除' : '没有找到这个页面'} description={route.name === 'retired' ? '独立工具页面已撤下。请从项目开始分析；已保存的数据仍然保留。' : '请核对地址，或返回项目继续。'}><Button variant='default' onClick={() => navigate({ name: 'repositories' })} type="button">返回项目</Button></EmptyState>
  else content = <ProjectsPage navigate={navigate}/>
  return <ReviewAccountProvider value={accountValue}><AppShell route={route} navigate={navigate} repositories={repositories.items} session={session} onSession={setSession}><ErrorBoundary><Suspense fallback={<LoadingNotice label="正在加载页面"/>}>{content}</Suspense></ErrorBoundary></AppShell></ReviewAccountProvider>
}

function LegacySync({ route, navigate }: { route: Extract<Route, { name: 'legacy-sync' }>; navigate: (route: Route, replace?: boolean) => void }) {
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    apiRequest({ path: `/api/v1/repository-syncs/${encodeURIComponent(route.syncId)}`, method: 'GET', signal: controller.signal }).then(parseSync).then(job => {
      if (controller.signal.aborted) return
      if (job.syncId !== route.syncId || !job.repositoryId || job.status !== 'completed') throw new Error('该作业尚无成功分析结果。')
      navigate(analysisRoute(job.repositoryId, job.syncId, { view: route.view }), true)
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '分析读取失败') })
    return () => controller.abort()
  }, [route.syncId, route.view, navigate])
  return error ? <EmptyState title="分析不可用" description={error}><Button variant="ghost" onClick={() => navigate({ name: 'repositories' })}>返回项目</Button></EmptyState> : <LoadingNotice label="正在读取原分析"/>
}
