import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import type { Route } from '../navigation'
import { userLogin, userRegister, type UserSession } from '../userClient'
import { Icon } from '../Icon'
import { Button, Input, PasswordInput } from '../ui/controls'
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
  function afterAdmin() { navigate({ name: 'admin', view: 'models' }) }
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
      <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'landing' })}>返回首页</Button>
    </header>
    <main className="entry-login-main">
      <section className="entry-login-aside">
        <p className="entry-eyebrow">账户入口</p>
        <h1>{role === 'admin' ? '进入管理工作区' : '登录后进入你的工作区'}</h1>
        <p>{role === 'admin'
          ? '管理员维护全局数据集、模型目录、默认模型和验证记录；管理员身份不代替普通用户。'
          : '用户账户拥有自己的数据集、训练实验和模型；模型只在本人项目中可选。'}</p>
        <ul className="entry-points">
          <li><b>身份分离</b><span>用户与管理员的会话互相独立</span></li>
          <li><b>数据归属</b><span>本人数据与模型不向其他用户可见</span></li>
          <li><b>可复核</b><span>训练记录、切分和模型身份都保留来源</span></li>
        </ul>
      </section>
      <section className="entry-login-card" aria-label="登录表单">
        <div className="entry-tabs" role="tablist" aria-label="登录身份">
          <button role="tab" aria-selected={role === 'user'} onClick={() => { setRole('user'); setError('') }}>用户登录</button>
          <button role="tab" aria-selected={role === 'admin'} onClick={() => { setRole('admin'); setError('') }}>管理员登录</button>
        </div>
        {role === 'admin' && admin.loading ? <p className="quiet-empty">正在检查管理员状态…</p> : null}
        {role === 'admin' && adminReady && admin.authenticated ? <div className="entry-login-done">
          <p>当前已登录为管理员 {admin.username ?? ''}。</p>
          <Button variant="primary" block onClick={afterAdmin}>进入管理工作区</Button>
        </div> : null}
        {role === 'user' && session?.authenticated ? <div className="entry-login-done">
          <p>当前已登录为用户 {session.username}。</p>
          <Button variant="primary" block onClick={() => navigate({ name: 'repositories' })}>继续进入项目</Button>
        </div> : null}
        {(!adminReady || !admin.authenticated) && !(role === 'user' && session?.authenticated) ? <form className="entry-login-form" onSubmit={submit}>
          {role === 'admin' && admin.setupRequired ? <p className="entry-form-note">首次使用，需要先建立管理员账户（密码至少 12 位）。</p> : null}
          <label className="admin-field"><span className="admin-field-label">账户名</span>
            <Input aria-label={role === 'admin' ? '管理员账户名' : '用户账户名'} autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)} autoFocus/>
          </label>
          <label className="admin-field"><span className="admin-field-label">密码</span>
            <PasswordInput aria-label={role === 'admin' ? '管理员密码' : '用户密码'} autoComplete={mode === 'register' || admin.setupRequired ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/>
          </label>
          {role === 'admin' && admin.setupRequired ? <label className="admin-field"><span className="admin-field-label">确认密码</span>
            <PasswordInput aria-label="确认管理员密码" autoComplete="new-password" maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)}/>
          </label> : null}
          {role === 'user' && mode === 'register' ? <p className="entry-form-note">密码至少 8 位。</p> : null}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <Button variant="primary" type="submit" loading={busy} block>
            {role === 'admin' ? (admin.setupRequired ? '建立管理员并进入' : '登录管理') : (mode === 'register' ? '注册并进入' : '登录')}
          </Button>
          {role === 'user' ? <button type="button" className="entry-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? '还没有账户？注册一个' : '已有账户？返回登录'}
          </button> : null}
        </form> : null}
      </section>
    </main>
  </div>
}
