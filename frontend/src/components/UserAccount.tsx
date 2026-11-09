import { useEffect, useState, type FormEvent } from 'react'
import type { Route } from '../navigation'
import type { UserSession } from '../userClient'
import { notifyUserChanged, userLogin, userLogout, userRegister } from '../userClient'
import { Button, Input, PasswordInput } from '../ui/controls'
import { Dialog } from '../ui/dialog'
import { Dropdown } from '../ui/dropdown'
import { Segmented } from '../ui/segmented'

/** 触发登录对话框；页面遇到 401 时调用。 */
export const LOGIN_EVENT = 'jit:show-login'
export function requestLogin() { window.dispatchEvent(new Event(LOGIN_EVENT)) }

/** 普通用户账户入口：未登录显示“登录 / 注册”，登录后提供我的数据、训练和模型。 */
export function UserAccount({ session, onChange, navigate }: {
  session: UserSession | null
  onChange: (session: UserSession) => void
  navigate: (route: Route) => void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const openDialog = () => setOpen(true)
    window.addEventListener(LOGIN_EVENT, openDialog)
    return () => window.removeEventListener(LOGIN_EVENT, openDialog)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const result = mode === 'register'
        ? await userRegister(username, password)
        : await userLogin(username, password)
      onChange(result)
      notifyUserChanged()
      setOpen(false); setPassword('')
      navigate({ name: 'my-data' })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (mode === 'register' ? '注册失败' : '登录失败'))
    } finally { setBusy(false) }
  }
  async function logout() {
    try { await userLogout() } finally {
      onChange({ authenticated: false, username: null })
      notifyUserChanged()
      navigate({ name: 'repositories' })
    }
  }
  if (session?.authenticated) {
    return <Dropdown align="end" items={[
      { key: 'data', label: '我的数据' },
      { key: 'training', label: '我的训练' },
      { key: 'models', label: '我的模型' },
      { key: 'logout', label: '退出登录', danger: true },
    ]} onClick={key => {
      if (key === 'data') navigate({ name: 'my-data' })
      else if (key === 'training') navigate({ name: 'my-training' })
      else if (key === 'models') navigate({ name: 'my-models' })
      else void logout()
    }}>
      <Button variant="ghost" size="sm">{session.username}</Button>
    </Dropdown>
  }
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>登录 / 注册</Button>
    <Dialog open={open} onOpenChange={setOpen} title={mode === 'register' ? '注册用户账户' : '用户登录'} width={420}>
      <form className="user-auth-form" onSubmit={submit}>
        <Segmented aria-label="账户操作" value={mode} onChange={value => { setMode(value as 'login' | 'register'); setError('') }} options={[
          { label: '登录', value: 'login' }, { label: '注册', value: 'register' },
        ]}/>
        <label className="admin-field"><span className="admin-field-label">账户名</span>
          <Input aria-label="用户账户名" autoComplete="username" maxLength={80} value={username} onChange={event => setUsername(event.target.value)} autoFocus/>
        </label>
        <label className="admin-field"><span className="admin-field-label">密码</span>
          <PasswordInput aria-label="用户密码" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={256} value={password} onChange={event => setPassword(event.target.value)}/>
        </label>
        {mode === 'register' ? <p className="admin-field-note">密码至少 8 位。</p> : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <Button variant="primary" type="submit" loading={busy} block>{mode === 'register' ? '注册并进入' : '登录'}</Button>
      </form>
    </Dialog>
  </>
}
