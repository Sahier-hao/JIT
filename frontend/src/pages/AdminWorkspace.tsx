import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import { EmptyState, LoadingNotice } from '../Feedback'
import { Icon, type IconName } from '../Icon'
import { hashFor, type Route } from '../navigation'
import { VerificationReport } from '../VerificationReport'
import { AppearanceControl } from '../components/AppearanceControl'
import { Button } from '../ui/controls'
import { AdminComparisonPage } from './admin/AdminComparisonPage'
import { AdminDatasetsPage } from './admin/AdminDatasetsPage'
import { AdminExperimentDetailPage } from './admin/AdminExperimentDetailPage'
import { AdminExperimentsPage } from './admin/AdminExperimentsPage'
import { AdminExperimentRunsPage } from './admin/AdminExperimentRunsPage'
import { AdminModelDetailPage } from './admin/AdminModelDetailPage'
import { AdminModelsPage } from './admin/AdminModelsPage'
import { AdminTrainingPage } from './admin/AdminTrainingPage'
import { AdminTrainingExperimentPage } from './admin/AdminTrainingExperimentPage'

interface Session { authenticated: boolean; setupRequired: boolean; username: string | null }

function label(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

const NAV: { view: 'models' | 'datasets' | 'training' | 'experiment-runs' | 'comparisons' | 'experiments'; label: string; icon: IconName }[] = [
  { view: 'models', label: '模型管理', icon: 'sliders' },
  { view: 'datasets', label: '数据集', icon: 'list' },
  { view: 'training', label: '训练任务', icon: 'trend' },
  { view: 'experiment-runs', label: '实验登记', icon: 'list' },
  { view: 'comparisons', label: '模型比较', icon: 'sort' },
  { view: 'experiments', label: '多项目实验', icon: 'trend' },
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
  if (!session) return <div className="admin-boot">
    {sessionError
      ? <EmptyState title="管理服务暂时不可用" description={sessionError}><Button onClick={() => setRevision(value => value + 1)}>重新连接</Button></EmptyState>
      : <LoadingNotice label="正在检查管理会话"/>}
  </div>

  if (!session.authenticated) return <div className="admin-boot"><LoadingNotice label="正在前往管理员登录"/></div>

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
  return <div className="admin-frame">
    <a className="skip-link" href="#admin-main">跳到主要内容</a>
    <aside className="admin-rail">
      <button className="admin-rail-brand" onClick={() => navigate({ name: 'landing' })}><span className="brand-glyph"><Icon name="logo" size={22}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <nav className="admin-nav" aria-label="管理导航">
        {NAV.map(item => <button key={item.view} aria-current={active(item.view)} onClick={() => navigate({ name: 'admin', view: item.view })}><Icon name={item.icon} size={17}/><span>{item.label}</span></button>)}
        <button aria-current={route.name === 'report' ? 'page' : undefined} onClick={() => navigate({ name: 'report', view: 'overview' })}><Icon name="download" size={17}/><span>验证报告</span></button>
      </nav>
      <div className="admin-rail-footer">
        <div className="admin-account"><span className="admin-account-name">{label(session.username, '管理员')}</span><span className="admin-account-role">管理员</span></div>
        <div className="admin-rail-actions">
          <Button variant="ghost" size="sm" onClick={() => void logout()}>退出管理</Button>
        </div>
      </div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar">
        <nav className="admin-breadcrumb" aria-label="面包屑"><span>管理工作区</span><span aria-hidden="true">/</span><b>{section}</b></nav>
        <AppearanceControl/>
      </header>
      <main className="admin-content" id="admin-main" tabIndex={-1}>
        {sessionError ? <p role="alert" className="admin-inline-error">{sessionError}</p> : null}
        {content}
      </main>
    </div>
  </div>
}
