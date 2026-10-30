import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import { EmptyState, LoadingNotice } from '../Feedback'
import type { Route } from '../navigation'
import { VerificationReport } from '../VerificationReport'
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
  if (!session) return sessionError
    ? <EmptyState title="管理服务暂时不可用" description={sessionError}><Button onClick={() => setRevision(value => value + 1)}>重新连接</Button></EmptyState>
    : <LoadingNotice label="正在检查管理会话"/>
  if (!session.authenticated) return <AdminSignIn setup={session.setupRequired} onSignedIn={setSession}/>
  async function logout() {
    try {
      await apiRequest({ path: '/api/admin/logout', method: 'POST' })
      expired()
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : '退出失败')
    }
  }
  const active = (view: 'models' | 'datasets' | 'training' | 'comparisons') => route.name === 'admin' && route.view === view ? 'page' : undefined
  let content
  if (route.name === 'report') content = <VerificationReport route={route} navigate={navigate}/>
  else if (route.view === 'models' && route.resourceId) content = <AdminModelDetailPage modelId={route.resourceId} navigate={navigate} expired={expired}/>
  else if (route.view === 'models') content = <AdminModelsPage navigate={navigate} expired={expired}/>
  else if (route.view === 'datasets') content = <AdminDatasetsPage dataset={route.resourceId} version={route.version} navigate={navigate} expired={expired}/>
  else if (route.view === 'training') content = <AdminTrainingPage taskId={route.resourceId} navigate={navigate} expired={expired}/>
  else content = <AdminComparisonPage modelIds={route.models} navigate={navigate} expired={expired}/>
  return <div className="admin-workspace">
    <div className="admin-toolbar"><span className="admin-badge">管理员 · {session.username}</span><Button variant="ghost" onClick={() => void logout()}>退出管理</Button><Button variant="ghost" onClick={() => navigate({ name: 'repositories' })}>返回用户工作区</Button></div>
    <nav className="view-tabs" aria-label="管理导航">
      <Button variant="ghost" size="sm" aria-current={active('models')} onClick={() => navigate({ name: 'admin', view: 'models' })}>模型管理</Button>
      <Button variant="ghost" size="sm" aria-current={active('datasets')} onClick={() => navigate({ name: 'admin', view: 'datasets' })}>数据集</Button>
      <Button variant="ghost" size="sm" aria-current={active('training')} onClick={() => navigate({ name: 'admin', view: 'training' })}>训练任务</Button>
      <Button variant="ghost" size="sm" aria-current={active('comparisons')} onClick={() => navigate({ name: 'admin', view: 'comparisons' })}>模型比较</Button>
      <Button variant="ghost" size="sm" aria-current={route.name === 'report' ? 'page' : undefined} onClick={() => navigate({ name: 'report', view: 'overview' })}>验证报告</Button>
    </nav>
    {sessionError ? <p role="alert" className="field-error">{sessionError}</p> : null}
    {content}
  </div>
}

function AdminSignIn({ setup, onSignedIn }: { setup: boolean; onSignedIn: (session: Session) => void }) {
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
  return <section className="admin-signin">
    <div className="admin-signin-intro"><h1>{setup ? '建立管理员账户' : '管理员登录'}</h1><p>在独立工作区维护数据集、训练任务、模型指标和验证记录。项目审查无需管理员登录。</p></div>
    <form className="admin-signin-form" onSubmit={submit}>
      <div className="pr-field"><span className="pr-field-label">账户名</span><Input aria-label="管理员账户名" autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)}/></div>
      <div className="pr-field"><span className="pr-field-label">密码</span><PasswordInput aria-label="管理员密码" autoComplete={setup ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/></div>
      {setup ? <><div className="pr-field"><span className="pr-field-label">确认密码</span><PasswordInput aria-label="确认管理员密码" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></div><p className="admin-signin-hint">首次使用请建立本机管理员，密码至少 12 位。</p></> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <Button variant="primary" type="submit" loading={busy} block>{setup ? '建立账户并进入' : '登录管理工作区'}</Button>
    </form>
  </section>
}
