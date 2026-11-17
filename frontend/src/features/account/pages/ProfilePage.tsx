import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'
import { PasswordField } from '@/components/shared/PasswordField'
import { Input } from '@/components/ui/input'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '@/lib/apiContract'
import type { Route } from '@/app/navigation'
import { changeUserPassword, updateUserProfile, userLogout, userProfile, type UserProfile, notifyUserChanged } from '@/features/account/userClient'

import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'


export function ProfilePage({ navigate, onLoginRequired, onSessionCleared }: {
  navigate: (route: Route) => void
  onLoginRequired: () => void
  onSessionCleared: () => void
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    userProfile(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setProfile(value); setDisplayName(value.displayName ?? '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '个人资料读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired])

  async function saveName(event: FormEvent) {
    event.preventDefault()
    setBusy('name'); setError(''); setNotice('')
    try {
      const result = await updateUserProfile(displayName)
      setProfile(value => value ? { ...value, displayName: result.displayName } : value)
      setNotice('显示名称已保存')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '保存失败')
    } finally { setBusy('') }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setBusy('password'); setError(''); setNotice('')
    try {
      await changeUserPassword(currentPassword, newPassword)
      setCurrentPassword(''); setNewPassword('')
      setNotice('密码已更新；其他浏览器的登录已失效')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '密码修改失败')
    } finally { setBusy('') }
  }
  async function logout() {
    try { await userLogout() } finally {
      notifyUserChanged()
      onSessionCleared()
      navigate({ name: 'landing' })
    }
  }

  if (!profile) return <section className="grid gap-4">
    {error ? <EmptyState title="个人资料不可用" description={error}><Button onClick={onLoginRequired} variant="outline" type="button">登录</Button></EmptyState> : <LoadingNotice label="正在读取个人资料"/>}
  </section>
  const name = profile.displayName || profile.username
  return <section className="grid gap-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">个人空间</h1><span className="text-xs text-foreground-3">{profile.username}</span></header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {notice ? <p className="text-xs text-teal-deep" role="status">{notice}</p> : null}
    <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
      <section className="grid justify-items-center gap-2 rounded-md border border-border-soft bg-card p-card text-center">
        <div className="grid size-16 place-items-center rounded-full bg-accent-soft text-2xl font-semibold text-accent" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
        <h2 className="text-base font-semibold text-foreground">{name}</h2>
        <p className="text-xs text-foreground-3">账户 {profile.username}</p>
        <p className="text-xs text-foreground-4">创建于 {new Date(profile.createdAt * 1000).toLocaleString('zh-CN', { hour12: false })}</p>
        <div className="grid w-full grid-cols-3 gap-2 border-t border-border-soft pt-2">
          <Button variant="ghost" className="h-auto grid gap-0.5 rounded-sm border-0 bg-transparent p-1.5 whitespace-normal hover:bg-hover" onClick={() => navigate({ name: 'my-data' })}><b className="text-lg font-semibold tabular-nums text-foreground">{profile.datasetCount}</b><span className="text-[11px] text-foreground-3">数据版本</span></Button>
          <Button variant="ghost" className="h-auto grid gap-0.5 rounded-sm border-0 bg-transparent p-1.5 whitespace-normal hover:bg-hover" onClick={() => navigate({ name: 'my-training' })}><b className="text-lg font-semibold tabular-nums text-foreground">{profile.experimentCount}</b><span className="text-[11px] text-foreground-3">训练实验</span></Button>
          <Button variant="ghost" className="h-auto grid gap-0.5 rounded-sm border-0 bg-transparent p-1.5 whitespace-normal hover:bg-hover" onClick={() => navigate({ name: 'my-models' })}><b className="text-lg font-semibold tabular-nums text-foreground">{profile.modelCount}</b><span className="text-[11px] text-foreground-3">我的模型</span></Button>
        </div>
        <Button variant="ghost" onClick={() => void logout()} type="button">退出登录</Button>
      </section>
      <div className="grid gap-4">
        <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">显示名称</h2>
          <form className="grid justify-items-start gap-3" onSubmit={saveName}>
            <label className="grid w-full gap-1.5"><span className="text-xs font-medium text-foreground-2">显示名称</span>
              <Input aria-label="显示名称" maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="留空则显示账户名"/>
            </label>
            <Button variant='default' type="submit" disabled={Boolean(busy === 'name')}>{busy === 'name' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}保存名称</Button>
          </form>
        </section>
        <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">修改密码</h2>
          <form className="grid justify-items-start gap-3" onSubmit={changePassword}>
            <label className="grid w-full gap-1.5"><span className="text-xs font-medium text-foreground-2">当前密码</span>
              <PasswordField aria-label="当前密码" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/>
            </label>
            <label className="grid w-full gap-1.5"><span className="text-xs font-medium text-foreground-2">新密码</span>
              <PasswordField aria-label="新密码" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}/>
            </label>
            <Button variant='default' type="submit" disabled={Boolean(!currentPassword || newPassword.length < 8) || Boolean(busy === 'password')}>{busy === 'password' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}更新密码</Button>
          </form>
        </section>
      </div>
    </div>
  </section>
}
