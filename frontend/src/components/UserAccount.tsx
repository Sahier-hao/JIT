import type { Route } from '../navigation'
import type { UserSession } from '../userClient'
import { notifyUserChanged, userLogout } from '../userClient'
import { Button } from '../ui/controls'
import { Dropdown } from '../ui/dropdown'

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
      onChange({ authenticated: false, username: null })
      notifyUserChanged()
      navigate({ name: 'landing' })
    }
  }
  if (session?.authenticated) {
    return <Dropdown align="end" items={[
      { key: 'data', label: '我的数据' },
      { key: 'training', label: '我的训练' },
      { key: 'models', label: '我的模型' },
      { key: 'profile', label: '个人空间' },
      { key: 'logout', label: '退出登录', danger: true },
    ]} onClick={key => {
      if (key === 'data') navigate({ name: 'my-data' })
      else if (key === 'training') navigate({ name: 'my-training' })
      else if (key === 'models') navigate({ name: 'my-models' })
      else if (key === 'profile') navigate({ name: 'profile' })
      else void logout()
    }}>
      <Button variant="ghost" size="sm">{session.username}</Button>
    </Dropdown>
  }
  return <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'login', role: 'user' })}>登录 / 注册</Button>
}
