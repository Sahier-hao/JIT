import { Button } from '@/components/ui/button'
import { AccountMenu } from '@/components/layout/AccountMenu'
import type { Route } from '@/app/navigation'
import { type UserSession, notifyUserChanged, userLogout } from '@/features/account/userClient'
import { ProfileDialog } from '@/features/account/components/ProfileDialog'
import { useState } from 'react'




/** 打开登录页并记住当前地址；页面遇到 401 时调用。 */
export const LOGIN_EVENT = 'jit:show-login'
export function requestLogin() {
  const next = window.location.hash || '#/projects'
  window.location.hash = `#/login?role=user&next=${encodeURIComponent(next)}`
}

/** 顶栏账户入口：未登录跳登录页，登录后提供个人中心窗口和退出。 */
export function UserAccount({ session, onChange, navigate, route }: {
  session: UserSession | null
  onChange: (session: UserSession) => void
  navigate: (route: Route) => void
  route: Route
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const showProfile = profileOpen || route.name === 'profile'

  function changeProfileOpen(open: boolean) {
    setProfileOpen(open)
    if (!open && route.name === 'profile') navigate({ name: 'repositories' })
  }

  async function logout() {
    try { await userLogout() } finally {
      onChange({ authenticated: false, username: null, status: 'anonymous' })
      notifyUserChanged()
      navigate({ name: 'landing' })
    }
  }
  if (session?.authenticated) {
    return <>
      <AccountMenu username={session.username ?? '我的账户'} role="user"
        onProfile={() => setProfileOpen(true)} onLogout={() => void logout()}/>
      <ProfileDialog open={showProfile} onOpenChange={changeProfileOpen} onLoginRequired={requestLogin} navigate={navigate}/>
    </>
  }
  return <Button className="max-w-[min(40vw,180px)] truncate" variant="ghost" size="sm" onClick={() => navigate({ name: 'login', role: 'user' })} type="button">登录 / 注册</Button>
}
