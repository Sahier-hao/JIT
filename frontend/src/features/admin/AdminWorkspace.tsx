import { type LucideIcon, SlidersHorizontal, List, TrendingUp, ChartNoAxesCombined, ChevronRight } from 'lucide-react'
import { BrandLogo } from '@/components/shared/BrandLogo'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { record } from '@/lib/apiContract'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'

import { hashFor, linkTo, type Route } from '@/app/navigation'
import { AppearanceControl } from '@/components/layout/AppearanceControl'
import { ActiveJobsIndicator } from '@/components/layout/ActiveJobsIndicator'
import { useActiveAdminJobs } from '@/features/admin/activeJobs'

import { AdminDatasetsPage } from '@/features/admin/AdminDatasetsPage'
import { AdminExperimentRunsPage } from '@/features/admin/AdminExperimentRunsPage'
import { AdminModelDetailPage } from '@/features/admin/AdminModelDetailPage'
import { AdminModelsPage } from '@/features/admin/AdminModelsPage'
import { AdminTrainingPage } from '@/features/admin/AdminTrainingPage'
import { AdminTrainingExperimentPage } from '@/features/admin/AdminTrainingExperimentPage'

const VerificationReport = lazy(() => import('@/features/research/VerificationReport').then(module => ({ default: module.VerificationReport })))
const AdminComparisonPage = lazy(() => import('@/features/admin/AdminComparisonPage').then(module => ({ default: module.AdminComparisonPage })))
const AdminExperimentsPage = lazy(() => import('@/features/admin/AdminExperimentsPage').then(module => ({ default: module.AdminExperimentsPage })))
const AdminExperimentDetailPage = lazy(() => import('@/features/admin/AdminExperimentDetailPage').then(module => ({ default: module.AdminExperimentDetailPage })))

interface Session { authenticated: boolean; setupRequired: boolean; username: string | null }

function label(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

const NAV: { view: 'models' | 'datasets' | 'training' | 'experiment-runs' | 'evaluation'; label: string; icon: LucideIcon }[] = [
  { view: 'models', label: '模型管理', icon: SlidersHorizontal },
  { view: 'datasets', label: '数据集', icon: List },
  { view: 'training', label: '训练任务', icon: TrendingUp },
  { view: 'experiment-runs', label: '登记实验产物', icon: List },
  { view: 'evaluation', label: '模型评估', icon: ChartNoAxesCombined },
]

const SECTION_TITLES: Record<Extract<Route, { name: 'admin' }>['view'], string> = {
  models: '模型管理', datasets: '数据集', training: '训练任务', 'training-experiment': '训练实验',
  'experiment-runs': '实验登记', evaluation: '模型评估', comparisons: '模型比较', experiments: '多项目实验',
}

const EVALUATION_LINKS = [
  { label: '模型比较', detail: '并排核对两个已登记模型的指标和数据口径', route: { name: 'admin', view: 'comparisons' } },
  { label: '多项目实验', detail: '查看跨项目实验结果、评价证据和失败记录', route: { name: 'admin', view: 'experiments' } },
  { label: '验证报告', detail: '回看历史模型验证、提交明细和趋势', route: { name: 'report', view: 'overview' } },
] as const satisfies readonly { label: string; detail: string; route: Route }[]

export function AdminWorkspace({ route, navigate }: {
  route: Extract<Route, { name: 'admin' | 'report' }>
  navigate: (route: Route) => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [revision, setRevision] = useState(0)
  const expired = useCallback(() => setSession({ authenticated: false, username: null, setupRequired: false }), [])
  const onTrainingPage = route.name === 'admin' && (route.view === 'training' || route.view === 'training-experiment')
  const activeJobs = useActiveAdminJobs(session?.authenticated === true && !onTrainingPage)
  useEffect(() => {
    const controller = new AbortController()
    const read = () => apiRequest({ path: '/api/admin/session', method: 'GET', signal: controller.signal, timeoutMs: 15_000 }).then(body => {
      const value = record(body)
      if (!controller.signal.aborted) {
        setSession({ authenticated: value.authenticated === true, setupRequired: value.setupRequired === true, username: typeof value.username === 'string' ? value.username : null })
        setSessionError('')
      }
    }).catch(error => { if (!controller.signal.aborted) setSessionError(error instanceof Error ? error.message : '登录状态读取失败') })
    void read()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void read() }, 60000)
    window.addEventListener('focus', read)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', read) }
  }, [revision])

  useEffect(() => {
    if (session && !session.authenticated) navigate({ name: 'login', role: 'admin', next: hashFor(route) })
  }, [session, navigate, route])
  if (!session) return <div className="grid min-h-screen place-items-center p-8">
    {sessionError
      ? <EmptyState title="管理服务暂时不可用" description={sessionError}><Button onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重新连接</Button></EmptyState>
      : <LoadingNotice label="正在检查管理会话"/>}
  </div>

  if (!session.authenticated) return <div className="grid min-h-screen place-items-center p-8"><LoadingNotice label="正在前往管理员登录"/></div>

  async function logout() {
    try {
      await apiRequest({ path: '/api/admin/logout', method: 'POST' })
      expired()
      navigate({ name: 'login', role: 'admin' })
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : '退出失败')
    }
  }
  const evaluationView = route.name === 'report' ? 'report'
    : route.view === 'comparisons' || route.view === 'experiments' ? route.view : null
  const active = (view: typeof NAV[number]['view']) => (view === 'evaluation' && evaluationView)
    || (route.name === 'admin' && (route.view === view || view === 'training' && route.view === 'training-experiment'))
  const section = route.name === 'report' ? '验证报告' : SECTION_TITLES[route.view]
  let content
  if (route.name === 'report') content = <VerificationReport route={route} navigate={navigate}/>
  else if (route.view === 'evaluation') content = <section className="grid gap-4">
    <h1 className="text-xl font-semibold">模型评估</h1>
    <div className="grid gap-3 md:grid-cols-3">
      {EVALUATION_LINKS.map(link => <a key={link.label} {...linkTo(link.route, navigate)}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-lg border border-border-soft bg-card p-4 hover:bg-hover">
        <span className="text-base font-semibold text-foreground">{link.label}</span>
        <ChevronRight className="mt-0.5 size-4 text-foreground-3" aria-hidden="true"/>
        <span className="col-span-2 text-sm text-foreground-3">{link.detail}</span>
      </a>)}
    </div>
  </section>
  else if (route.view === 'models' && route.resourceId) content = <AdminModelDetailPage key={route.resourceId} modelId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'models') content = <AdminModelsPage selectedModelId={route.selectedModelId} navigate={navigate} expired={expired}/>
  else if (route.view === 'datasets') content = <AdminDatasetsPage dataset={route.resourceId} version={route.version} navigate={navigate} expired={expired}/>
  else if (route.view === 'training') content = <AdminTrainingPage taskId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'training-experiment' && route.resourceId) content = <AdminTrainingExperimentPage experimentId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'experiment-runs') content = <AdminExperimentRunsPage candidateId={route.resourceId} filters={{
    registrationState: route.registrationState,
    compatibility: route.compatibility,
    artifactState: route.artifactState,
    offset: route.offset,
  }} navigate={navigate} expired={expired}/>
  else if (route.view === 'experiments' && route.resourceId) content = <AdminExperimentDetailPage reportId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'experiments') content = <AdminExperimentsPage navigate={navigate} expired={expired}/>
  else content = <AdminComparisonPage key={route.models?.join(',') ?? ''} modelIds={route.models} navigate={navigate} expired={expired}/>
  return <div className="min-h-screen bg-background lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
    <a className="fixed left-2.5 top-[-60px] z-[100] rounded-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:top-2.5" href="#admin-main">跳到主要内容</a>
    <aside className="flex flex-col border-b border-border bg-rail px-3.5 py-4 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-hidden lg:border-b-0 lg:border-r">
      <Button variant="ghost" type="button" className="h-auto flex items-center gap-3 border-0 border-b border-border-soft bg-transparent px-2 pb-3.5 text-left" onClick={() => navigate({ name: 'landing' })}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><BrandLogo aria-hidden="true" focusable="false" strokeWidth={1.5} size={18}/></span><span className="flex flex-col leading-none"><span className="font-display text-xl font-bold tracking-tight text-foreground">JIT</span><span className="mt-1 font-mono text-[10px] font-medium tracking-[.13em] text-foreground-4">REVIEW</span></span></Button>
      <nav className="mt-4 flex flex-wrap items-center gap-1 lg:grid" aria-label="管理导航">
        {NAV.map(item => <Button variant="ghost" key={item.view} type="button" aria-current={active(item.view) ? 'page' : undefined}
          className="flex h-9 shrink-0 justify-start gap-2.5 rounded-sm px-3 text-sm text-foreground-2 aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground"
          onClick={() => navigate({ name: 'admin', view: item.view })}>
          <item.icon aria-hidden="true" strokeWidth={1.5} size={17}/>{item.label}
        </Button>)}
      </nav>
    </aside>
    <div className="min-w-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-border bg-background px-5 sm:h-13 sm:px-6">
        <nav className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[.1em] text-foreground-4" aria-label="面包屑"><span>管理工作区</span><span aria-hidden="true">/</span><b className="font-medium text-foreground">{section}</b></nav>
        <div className="flex min-w-0 items-center gap-1.5">
          <ActiveJobsIndicator jobs={activeJobs} navigate={navigate}/>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button className="max-w-[min(40vw,180px)] truncate" variant="ghost" size="sm" type="button">{label(session.username, '管理员')}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => void logout()}>退出管理</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          <AppearanceControl/>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-page-x py-6 pb-14 outline-none" id="admin-main" tabIndex={-1}>
        {sessionError ? <p role="alert" className="text-xs text-rose">{sessionError}</p> : null}
        {evaluationView ? <nav className="mb-4 flex flex-wrap items-center gap-1 border-b border-border-soft pb-2" aria-label="模型评估视图">
          {EVALUATION_LINKS.map(link => {
            const selected = evaluationView === (link.route.name === 'report' ? 'report' : link.route.view)
            return <Button key={link.label} variant="ghost" size="sm" asChild className="aria-[current=page]:bg-sunken">
              <a {...linkTo(link.route, navigate)} aria-current={selected ? 'page' : undefined}>{link.label}</a>
            </Button>
          })}
        </nav> : null}
        <Suspense fallback={<LoadingNotice label="正在加载管理页面"/>}>{content}</Suspense>
      </main>
    </div>
  </div>
}
