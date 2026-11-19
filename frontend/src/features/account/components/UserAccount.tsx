import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { Route } from '@/app/navigation'
import { type UserSession, notifyUserChanged, userLogout } from '@/features/account/userClient'




/** 打开登录页并记住当前地址；页面遇到 401 时调用。 */
export const LOGIN_EVENT = 'jit:show-login'
export function requestLogin() {
  const next = window.location.hash || '#/projects'
  window.location.hash = `#/login?role=user&next=${encodeURIComponent(next)}`
}

/** 顶栏账户入口：未登录跳登录页，登录后提供我的数据、训练和模型。 */
export function UserAccount({ session, onChange, navigate }: {
  session: UserSession | null
  onChange: (session: UserSession) => void
  navigate: (route: Route) => void
}) {
  async function logout() {
    try { await userLogout() } finally {
      onChange({ authenticated: false, username: null, status: 'anonymous' })
      notifyUserChanged()
      navigate({ name: 'landing' })
    }
  }
  if (session?.authenticated) {
    return <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button className="max-w-[min(40vw,180px)] truncate" variant="ghost" size="sm" type="button">{session.username}</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{([
      { key: 'data', label: '我的数据' },
      { key: 'training', label: '我的训练' },
      { key: 'models', label: '我的模型' },
      { key: 'profile', label: '个人空间' },
      { key: 'logout', label: '退出登录', danger: true },
    ]).map(item => <DropdownMenuItem key={item.key} disabled={'disabled' in item && item.disabled === true} variant={'danger' in item && item.danger ? 'destructive' : 'default'} onSelect={() => (key => {
      if (key === 'data') navigate({ name: 'my-data' })
      else if (key === 'training') navigate({ name: 'my-training' })
      else if (key === 'models') navigate({ name: 'my-models' })
      else if (key === 'profile') navigate({ name: 'profile' })
      else void logout()
    })(item.key)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
  }
  return <Button className="max-w-[min(40vw,180px)] truncate" variant="ghost" size="sm" onClick={() => navigate({ name: 'login', role: 'user' })} type="button">登录 / 注册</Button>
}
