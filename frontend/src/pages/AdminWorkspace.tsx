import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import { EmptyState, LoadingNotice } from '../Feedback'
import { Icon, type IconName } from '../Icon'
import type { Route } from '../navigation'
import { VerificationReport } from '../VerificationReport'
import { AppearanceControl } from '../components/AppearanceControl'
import { Dialog } from '../ui/dialog'
import { Button, Input, PasswordInput } from '../ui/controls'
import { AdminComparisonPage } from './admin/AdminComparisonPage'
import { AdminDatasetsPage } from './admin/AdminDatasetsPage'
import { AdminModelDetailPage } from './admin/AdminModelDetailPage'
import { AdminModelsPage } from './admin/AdminModelsPage'
import { AdminTrainingPage } from './admin/AdminTrainingPage'

interface Session { authenticated: boolean; setupRequired: boolean; username: string | null }

function label(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

const NAV: { view: 'models' | 'datasets' | 'training' | 'comparisons'; label: string; icon: IconName }[] = [
  { view: 'models', label: '模型管理', icon: 'sliders' },
  { view: 'datasets', label: '数据集', icon: 'list' },
  { view: 'training', label: '训练任务', icon: 'trend' },
  { view: 'comparisons', label: '模型比较', icon: 'sort' },
]

const SECTION_TITLES: Record<'models' | 'datasets' | 'training' | 'comparisons', string> = {
  models: '模型管理', datasets: '数据集', training: '训练任务', comparisons: '模型比较',
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

  if (!session) return <div className="admin-boot">
    {sessionError
      ? <EmptyState title="管理服务暂时不可用" description={sessionError}><Button onClick={() => setRevision(value => value + 1)}>重新连接</Button></EmptyState>
      : <LoadingNotice label="正在检查管理会话"/>}
  </div>

  if (!session.authenticated) return <AdminSignIn setup={session.setupRequired} onSignedIn={setSession} onClose={() => navigate({ name: 'repositories' })}/>

  async function logout() {
    try {
      await apiRequest({ path: '/api/admin/logout', method: 'POST' })
      expired()
      navigate({ name: 'repositories' })
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
  else content = <AdminComparisonPage modelIds={route.models} navigate={navigate} expired={expired}/>

  return <div className="admin-frame">
    <a className="skip-link" href="#admin-main">跳到主要内容</a>
    <aside className="admin-rail">
      <button className="admin-rail-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-glyph"><Icon name="logo" size={22}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <nav className="admin-nav" aria-label="管理导航">
        {NAV.map(item => <button key={item.view} aria-current={active(item.view)} onClick={() => navigate({ name: 'admin', view: item.view })}><Icon name={item.icon} size={17}/><span>{item.label}</span></button>)}
        <button aria-current={route.name === 'report' ? 'page' : undefined} onClick={() => navigate({ name: 'report', view: 'overview' })}><Icon name="download" size={17}/><span>验证报告</span></button>
      </nav>
      <div className="admin-rail-footer">
        <div className="admin-account"><span className="admin-account-name">{label(session.username, '管理员')}</span><span className="admin-account-role">管理员</span></div>
        <div className="admin-rail-actions">
          <Button variant="ghost" size="sm" onClick={() => void logout()}>退出管理</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'repositories' })}>返回用户工作区</Button>
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

function AdminSignIn({ setup, onSignedIn, onClose }: {
  setup: boolean
  onSignedIn: (session: Session) => void
  onClose: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current) return
    if (setup && password !== confirmation) { setError('两次密码输入不一致'); return }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      const value = record(await apiRequest({ path: `/api/admin/${setup ? 'setup' : 'login'}`, method: 'POST', body: { username, password } }))
      if (value.authenticated !== true) throw new Error('未能确认登录，请重试')
      onSignedIn({ authenticated: true, username: label(value.username), setupRequired: false })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '登录失败')
    } finally {
      locked.current = false
      setBusy(false)
      setPassword('')
      setConfirmation('')
    }
  }
  return <div className="admin-auth-stage">
    <div className="admin-auth-masthead"><span className="brand-glyph"><Icon name="logo" size={22}/></span><span className="admin-auth-wordmark">JIT REVIEW</span><span className="admin-auth-divider"/><span className="admin-auth-section">管理工作区</span></div>
    <Dialog
      open
      onOpenChange={open => { if (!open) onClose() }}
      width={430}
      title={<span className="admin-auth-title">{setup ? '建立管理员账户' : '管理员登录'}</span>}
    >
      <form className="admin-auth-form" onSubmit={submit}>
        <label className="admin-field"><span className="admin-field-label">账户名</span><Input aria-label="管理员账户名" autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)} autoFocus/></label>
        <label className="admin-field"><span className="admin-field-label">密码</span><PasswordInput aria-label="管理员密码" autoComplete={setup ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/></label>
        {setup ? <label className="admin-field"><span className="admin-field-label">确认密码</span><PasswordInput aria-label="确认管理员密码" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label> : null}
        {setup ? <p className="admin-field-note">密码至少 12 位。</p> : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" loading={busy} block>{setup ? '建立账户并进入' : '登录'}</Button>
      </form>
    </Dialog>
  </div>
}
