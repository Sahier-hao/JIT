import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'
import { PasswordField } from '@/components/shared/PasswordField'
import { Input } from '@/components/ui/input'
import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from '../apiClient'
import { record } from '../apiContract'
import type { Route } from '../navigation'
import { userLogin, userRegister, type UserSession } from '../userClient'

import { EntryPage, EntryHeader } from '../components/EntryChrome'
import { cn } from '../lib/utils'

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
  return <EntryPage>
    <EntryHeader onHome={() => navigate({ name: 'landing' })} right={<Button variant="ghost" size="sm" onClick={() => navigate({ name: 'landing' })} type="button">返回首页</Button>}/>
    <main className="mx-auto grid w-full max-w-[1040px] flex-1 items-center gap-8 px-5 py-8 md:grid-cols-[minmax(0,1fr)_400px] md:gap-16 md:px-8 md:py-14">
      <section className="grid max-w-[480px] gap-4">
        <p className="text-xs uppercase tracking-[.14em] text-foreground-3">账户入口</p>
        <h1 className="font-display text-2xl leading-[1.18] tracking-tight text-foreground sm:text-3xl">{role === 'admin' ? '进入管理工作区' : '登录后进入你的工作区'}</h1>
        <p className="text-sm leading-[1.85] text-foreground-2">{role === 'admin'
          ? '管理员维护全局数据集、模型目录、默认模型和验证记录；管理员身份不代替普通用户。'
          : '用户账户拥有自己的数据集、训练实验和模型；模型只在本人项目中可选。'}</p>
        <ul className="mt-1 grid gap-2.5">
          <li className="grid gap-0.5 border-t border-border pt-2.5"><b className="text-sm font-semibold text-foreground">身份分离</b><span className="text-xs text-foreground-3">用户与管理员的会话互相独立</span></li>
          <li className="grid gap-0.5 border-t border-border pt-2.5"><b className="text-sm font-semibold text-foreground">数据归属</b><span className="text-xs text-foreground-3">本人数据与模型不向其他用户可见</span></li>
          <li className="grid gap-0.5 border-t border-border pt-2.5"><b className="text-sm font-semibold text-foreground">可复核</b><span className="text-xs text-foreground-3">训练记录、切分和模型身份都保留来源</span></li>
        </ul>
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-6" aria-label="登录表单">
        <div className="grid grid-cols-2 border-b border-border" role="tablist" aria-label="登录身份">
          {(['user', 'admin'] as const).map(item => <Button variant="ghost"
            key={item}
            type="button"
            role="tab"
            aria-selected={role === item}
            onClick={() => { setRole(item); setError('') }}
            className={cn(
              'border-0 border-b-2 bg-transparent px-1 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              role === item ? 'border-accent font-semibold text-foreground' : 'border-transparent text-foreground-3 hover:text-foreground',
            )}
          >{item === 'user' ? '用户登录' : '管理员登录'}</Button>)}
        </div>

        {role === 'admin' && admin.loading ? <p className="text-xs text-foreground-3">正在检查管理员状态…</p> : null}
        {role === 'admin' && adminReady && admin.authenticated ? <div className="grid justify-items-start gap-3">
          <p className="text-sm text-foreground-2">当前已登录为管理员 {admin.username ?? ''}。</p>
          <Button variant='default' onClick={afterAdmin} className="w-full" type="button">进入管理工作区</Button>
        </div> : null}
        {role === 'user' && session?.authenticated ? <div className="grid justify-items-start gap-3">
          <p className="text-sm text-foreground-2">当前已登录为用户 {session.username}。</p>
          <Button variant='default' onClick={() => navigate({ name: 'repositories' })} className="w-full" type="button">继续进入项目</Button>
        </div> : null}

        {(!adminReady || !admin.authenticated) && !(role === 'user' && session?.authenticated) ? <form className="grid gap-3" onSubmit={submit}>
          {role === 'admin' && admin.setupRequired ? <p className="text-xs text-foreground-3">首次使用，需要先建立管理员账户（密码至少 12 位）。</p> : null}
          <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">账户名</span>
            <Input aria-label={role === 'admin' ? '管理员账户名' : '用户账户名'} autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)} autoFocus/>
          </label>
          <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">密码</span>
            <PasswordField aria-label={role === 'admin' ? '管理员密码' : '用户密码'} autoComplete={mode === 'register' || admin.setupRequired ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/>
          </label>
          {role === 'admin' && admin.setupRequired ? <label className="grid gap-1.5"><span className="text-xs font-medium text-foreground-2">确认密码</span>
            <PasswordField aria-label="确认管理员密码" autoComplete="new-password" maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)}/>
          </label> : null}
          {role === 'user' && mode === 'register' ? <p className="text-xs text-foreground-3">密码至少 8 位。</p> : null}
          {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
          <Button variant='default' type="submit" className="w-full" disabled={Boolean(busy)}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}{role === 'admin' ? (admin.setupRequired ? '建立管理员并进入' : '登录管理') : (mode === 'register' ? '注册并进入' : '登录')}</Button>
          {role === 'user' ? <Button variant="ghost" type="button" className="justify-self-start border-0 bg-transparent text-xs text-accent underline underline-offset-2 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? '还没有账户？注册一个' : '已有账户？返回登录'}
          </Button> : null}
        </form> : null}
      </section>
    </main>
  </EntryPage>
}
