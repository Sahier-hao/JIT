import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../apiContract'
import type { Route } from '../navigation'
import {
  changeUserPassword, updateUserProfile, userLogout, userProfile, type UserProfile,
} from '../userClient'
import { Button, Input, PasswordInput } from '../ui/controls'
import { EmptyState, LoadingNotice } from '../Feedback'
import { notifyUserChanged } from '../userClient'
import '../styles/user-workspace.css'

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

  if (!profile) return <section className="user-workspace">
    {error ? <EmptyState title="个人资料不可用" description={error}><Button onClick={onLoginRequired}>登录</Button></EmptyState> : <LoadingNotice label="正在读取个人资料"/>}
  </section>
  const name = profile.displayName || profile.username
  return <section className="user-workspace">
    <header className="user-page-head"><h1>个人空间</h1><span>{profile.username}</span></header>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p className="user-notice" role="status">{notice}</p> : null}
    <div className="profile-layout">
      <section className="user-panel profile-card">
        <div className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
        <h2>{name}</h2>
        <p className="quiet-empty">账户 {profile.username}</p>
        <p className="quiet-empty">创建于 {new Date(profile.createdAt * 1000).toLocaleString('zh-CN', { hour12: false })}</p>
        <div className="profile-stats">
          <button onClick={() => navigate({ name: 'my-data' })}><b>{profile.datasetCount}</b><span>数据版本</span></button>
          <button onClick={() => navigate({ name: 'my-training' })}><b>{profile.experimentCount}</b><span>训练实验</span></button>
          <button onClick={() => navigate({ name: 'my-models' })}><b>{profile.modelCount}</b><span>我的模型</span></button>
        </div>
        <Button variant="ghost" onClick={() => void logout()}>退出登录</Button>
      </section>
      <div className="profile-forms">
        <section className="user-panel"><h2>显示名称</h2>
          <form className="profile-form" onSubmit={saveName}>
            <label className="admin-field"><span className="admin-field-label">显示名称</span>
              <Input aria-label="显示名称" maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="留空则显示账户名"/>
            </label>
            <Button variant="primary" type="submit" loading={busy === 'name'}>保存名称</Button>
          </form>
        </section>
        <section className="user-panel"><h2>修改密码</h2>
          <form className="profile-form" onSubmit={changePassword}>
            <label className="admin-field"><span className="admin-field-label">当前密码</span>
              <PasswordInput aria-label="当前密码" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/>
            </label>
            <label className="admin-field"><span className="admin-field-label">新密码</span>
              <PasswordInput aria-label="新密码" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}/>
            </label>
            <Button variant="primary" type="submit" loading={busy === 'password'} disabled={!currentPassword || newPassword.length < 8}>更新密码</Button>
          </form>
        </section>
      </div>
    </div>
  </section>
}
