import { type LucideIcon, SlidersHorizontal, List, TrendingUp, ArrowUpDown, Download } from 'lucide-react'
import { BrandLogo } from '@/components/shared/BrandLogo'
import { Button } from '@/components/ui/button'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/apiClient'
import { record } from '@/lib/apiContract'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'

import { hashFor, type Route } from '@/app/navigation'
import { VerificationReport } from '@/features/research/VerificationReport'
import { AppearanceControl } from '@/components/layout/AppearanceControl'

import { AdminComparisonPage } from '@/features/admin/AdminComparisonPage'
import { AdminDatasetsPage } from '@/features/admin/AdminDatasetsPage'
import { AdminExperimentDetailPage } from '@/features/admin/AdminExperimentDetailPage'
import { AdminExperimentsPage } from '@/features/admin/AdminExperimentsPage'
import { AdminExperimentRunsPage } from '@/features/admin/AdminExperimentRunsPage'
import { AdminModelDetailPage } from '@/features/admin/AdminModelDetailPage'
import { AdminModelsPage } from '@/features/admin/AdminModelsPage'
import { AdminTrainingPage } from '@/features/admin/AdminTrainingPage'
import { AdminTrainingExperimentPage } from '@/features/admin/AdminTrainingExperimentPage'

interface Session { authenticated: boolean; setupRequired: boolean; username: string | null }

function label(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

const NAV: { view: 'models' | 'datasets' | 'training' | 'experiment-runs' | 'comparisons' | 'experiments'; label: string; icon: LucideIcon }[] = [
  { view: 'models', label: '模型管理', icon: SlidersHorizontal },
  { view: 'datasets', label: '数据集', icon: List },
  { view: 'training', label: '训练任务', icon: TrendingUp },
  { view: 'experiment-runs', label: '实验登记', icon: List },
  { view: 'comparisons', label: '模型比较', icon: ArrowUpDown },
  { view: 'experiments', label: '多项目实验', icon: TrendingUp },
]

const SECTION_TITLES: Record<'models' | 'datasets' | 'training' | 'training-experiment' | 'experiment-runs' | 'comparisons' | 'experiments', string> = {
  models: '模型管理', datasets: '数据集', training: '训练任务', 'training-experiment': '训练实验', 'experiment-runs': '实验登记', comparisons: '模型比较', experiments: '多项目实验',
}

export function AdminWorkspace({ route, navigate }: {
  route: Extract<Route, { name: 'admin' | 'report' }>
  navigate: (route: Route) => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionError, setSessionError] = useState('')
  const [revision, setRevision] = useState(0)
  const expired = useCallback(() => setSession({ authenticated: false, username: null, setupRequired: false }), [])
  useEffect(() => {
    const controller = new AbortController()
    const read = () => apiRequest({ path: '/api/admin/session', method: 'GET', signal: controller.signal }).then(body => {
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
  const active = (view: typeof NAV[number]['view']) => route.name === 'admin' && route.view === view ? 'page' : undefined
  const section = route.name === 'report' ? '验证报告' : SECTION_TITLES[route.view]
  let content
  if (route.name === 'report') content = <VerificationReport route={route} navigate={navigate}/>
  else if (route.view === 'models' && route.resourceId) content = <AdminModelDetailPage modelId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'models') content = <AdminModelsPage navigate={navigate} expired={expired}/>
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
  else content = <AdminComparisonPage modelIds={route.models} navigate={navigate} expired={expired}/>
  return <div className="min-h-screen bg-background lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
    <a className="fixed left-2.5 top-[-60px] z-[100] rounded-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:top-2.5" href="#admin-main">跳到主要内容</a>
    <aside className="flex flex-col border-b border-border bg-rail px-3.5 py-4 lg:border-b-0 lg:border-r">
      <Button variant="ghost" type="button" className="flex items-center gap-3 border-0 border-b border-border-soft bg-transparent px-2 pb-3.5 text-left" onClick={() => navigate({ name: 'landing' })}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><BrandLogo aria-hidden="true" focusable="false" strokeWidth={1.5} size={18}/></span><span className="flex flex-col leading-none"><span className="font-display text-xl font-bold tracking-tight text-foreground">JIT</span><span className="mt-1 font-mono text-[10px] font-medium tracking-[.13em] text-foreground-4">REVIEW</span></span></Button>
      <nav className="mt-4 flex gap-1 overflow-x-auto lg:grid" aria-label="管理导航">
        {NAV.map(item => <Button variant="ghost" key={item.view} type="button" aria-current={active(item.view)} className="flex h-9 shrink-0 items-center gap-2.5 rounded-sm border-0 bg-transparent px-3 text-sm text-foreground-2 transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground" onClick={() => navigate({ name: 'admin', view: item.view })}><item.icon aria-hidden="true" focusable="false" strokeWidth={1.5} size={17}/><span>{item.label}</span></Button>)}
        <Button variant="ghost" type="button" aria-current={route.name === 'report' ? 'page' : undefined} className="flex h-9 shrink-0 items-center gap-2.5 rounded-sm border-0 bg-transparent px-3 text-sm text-foreground-2 transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground" onClick={() => navigate({ name: 'report', view: 'overview' })}><Download aria-hidden="true" focusable="false" strokeWidth={1.5} size={17}/><span>验证报告</span></Button>
      </nav>
      <div className="mt-auto grid gap-2 border-t border-border-soft pt-3">
        <div className="flex items-baseline justify-between gap-2 px-2 text-xs"><span className="truncate text-foreground">{label(session.username, '管理员')}</span><span className="text-foreground-4">管理员</span></div>
        <div className="flex flex-wrap gap-2 px-1">
          <Button variant="ghost" size="sm" onClick={() => void logout()} type="button">退出管理</Button>
        </div>
      </div>
    </aside>
    <div className="min-w-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-border bg-background px-5 sm:h-13 sm:px-6">
        <nav className="flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[.1em] text-foreground-4" aria-label="面包屑"><span>管理工作区</span><span aria-hidden="true">/</span><b className="font-medium text-foreground">{section}</b></nav>
        <AppearanceControl/>
      </header>
      <main className="mx-auto w-full max-w-[1440px] px-page-x py-6 pb-14 outline-none" id="admin-main" tabIndex={-1}>
        {sessionError ? <p role="alert" className="text-xs text-rose">{sessionError}</p> : null}
        {content}
      </main>
    </div>
  </div>
}
