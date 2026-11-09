import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import type { Route } from '../navigation'
import { userLogin, userRegister, type UserSession } from '../userClient'
import { Icon } from '../Icon'
import { Button, Input, PasswordInput } from '../ui/controls'
import { Segmented } from '../ui/segmented'
import '../styles/entry.css'

type Role = 'user' | 'admin'

/** 登录页：用户与管理员共用入口，按角色调用各自的会话接口。 */
export function LoginPage({ route, session, navigate, onUser }: {
  route: Extract<Route, { name: 'login' }>
  session: UserSession | null
  navigate: (route: Route) => void
  onUser: (session: UserSession) => void
}) {
  const [role, setRole] = useState<Role>(route.role ?? 'user')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [admin, setAdmin] = useState<{ loading: boolean; authenticated: boolean; setupRequired: boolean; username: string | null }>({
    loading: true, authenticated: false, setupRequired: false, username: null,
  })

  useEffect(() => { setRole(route.role ?? 'user'); setError('') }, [route.role])
  useEffect(() => {
    if (role !== 'admin') return
    const controller = new AbortController()
    setAdmin(value => ({ ...value, loading: true }))
    apiRequest({ path: '/api/admin/session', method: 'GET', signal: controller.signal }).then(body => {
      const value = record(body)
      if (controller.signal.aborted) return
      setAdmin({
        loading: false,
        authenticated: value.authenticated === true,
        setupRequired: value.setupRequired === true,
        username: typeof value.username === 'string' ? value.username : null,
      })
    }).catch(() => { if (!controller.signal.aborted) setAdmin({ loading: false, authenticated: false, setupRequired: false, username: null }) })
    return () => controller.abort()
  }, [role])

  function afterUser(result: UserSession) {
    onUser(result)
    if (route.next && route.next.startsWith('#/')) window.location.hash = route.next.slice(1)
    else navigate({ name: 'repositories' })
  }
  function afterAdmin() {
    navigate({ name: 'admin', view: 'models' })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (role === 'admin') {
        if (admin.setupRequired) {
          if (password !== confirmation) throw new Error('两次密码输入不一致')
          await apiRequest({ path: '/api/admin/setup', method: 'POST', body: { username, password } })
        } else {
          await apiRequest({ path: '/api/admin/login', method: 'POST', body: { username, password } })
        }
        afterAdmin()
      } else {
        const result = mode === 'register' ? await userRegister(username, password) : await userLogin(username, password)
        afterUser(result)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (role === 'admin' ? '管理员登录失败' : '用户登录失败'))
    } finally { setBusy(false); setPassword(''); setConfirmation('') }
  }

  const adminReady = role === 'admin' && !admin.loading
  return <div className="entry-page entry-login-page">
    <header className="entry-header">
      <button className="entry-brand" onClick={() => navigate({ name: 'landing' })}>
        <span className="brand-glyph"><Icon name="logo" size={22}/></span>
        <span>JIT<span className="brand-caption">REVIEW</span></span>
      </button>
      <Button variant="ghost" onClick={() => navigate({ name: 'landing' })}>返回首页</Button>
    </header>
    <main className="entry-login-main">
      <section className="entry-login-aside">
        <p className="entry-eyebrow">账户入口</p>
        <h1>登录后进入你的工作区</h1>
        <p>普通用户管理自己的数据集、训练与模型；管理员维护全局数据集、模型目录和默认模型。两种身份分别认证，互不代替。</p>
        {session?.authenticated && role === 'user' ? <Button variant="primary" onClick={() => navigate({ name: 'repositories' })}>以 {session.username} 进入项目</Button> : null}
      </section>
      <section className="entry-login-card">
        <Segmented aria-label="登录身份" value={role} onChange={value => { setRole(value as Role); setError('') }} options={[
          { label: '用户登录', value: 'user' }, { label: '管理员登录', value: 'admin' },
        ]}/>
        {role === 'user' ? <Segmented aria-label="用户操作" value={mode} onChange={value => { setMode(value as 'login' | 'register'); setError('') }} options={[
          { label: '登录', value: 'login' }, { label: '注册', value: 'register' },
        ]}/> : null}
        {role === 'admin' && admin.loading ? <p className="quiet-empty">正在检查管理员状态…</p> : null}
        {role === 'admin' && adminReady && admin.authenticated ? <div className="entry-login-done">
          <p>当前已登录为管理员 {admin.username ?? ''}。</p>
          <Button variant="primary" onClick={afterAdmin}>进入管理工作区</Button>
        </div> : null}
        {(!adminReady || !admin.authenticated) ? <form className="entry-login-form" onSubmit={submit}>
          {role === 'admin' && admin.setupRequired ? <p className="entry-form-note">首次使用，需要先建立管理员账户。</p> : null}
          <label className="admin-field"><span className="admin-field-label">账户名</span>
            <Input aria-label={role === 'admin' ? '管理员账户名' : '用户账户名'} autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)} autoFocus/>
          </label>
          <label className="admin-field"><span className="admin-field-label">密码</span>
            <PasswordInput aria-label={role === 'admin' ? '管理员密码' : '用户密码'} autoComplete={mode === 'register' || admin.setupRequired ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/>
          </label>
          {role === 'user' && mode === 'register' ? <p className="entry-form-note">密码至少 8 位。</p> : null}
          {role === 'admin' && admin.setupRequired ? <label className="admin-field"><span className="admin-field-label">确认密码</span>
            <PasswordInput aria-label="确认管理员密码" autoComplete="new-password" maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)}/>
          </label> : null}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button variant="primary" type="submit" loading={busy} block>
            {role === 'admin' ? (admin.setupRequired ? '建立管理员并进入' : '登录管理') : (mode === 'register' ? '注册并进入' : '登录')}
          </Button>
        </form> : null}
      </section>
    </main>
  </div>
}
