import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PasswordField } from '@/components/shared/PasswordField'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import { ApiError } from '@/lib/apiContract'
import { CalendarDays, ChevronRight, Database, FlaskConical, KeyRound, Layers3, LoaderCircle, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  changeUserPassword, updateUserProfile, userExperiments, userModels, userProfile,
  type UserModel, type UserProfile,
} from '@/features/account/userClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'
import type { Route } from '@/app/navigation'

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '训练中', completed: '已完成',
  partial: '部分完成', failed: '失败', cancelled: '已取消', interrupted: '已中断',
}

function dateText(epoch: number): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(epoch * 1000))
}

function modelReady(model: UserModel): boolean {
  return model.enabled && model.state === 'ready'
}

export function ProfileDialog({ open, onOpenChange, onLoginRequired, navigate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoginRequired: () => void
  navigate: (route: Route) => void
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} showCloseButton={false} className="max-h-[90vh] gap-0 overflow-y-auto p-0" style={{ width: 'min(92vw, 620px)', maxWidth: 'none' }}>
      {open ? <ProfileSettings onLoginRequired={onLoginRequired} navigate={navigate} onClose={() => onOpenChange(false)}/> : null}
    </DialogContent>
  </Dialog>
}

function ProfileSettings({ onLoginRequired, navigate, onClose }: {
  onLoginRequired: () => void
  navigate: (route: Route) => void
  onClose: () => void
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [recent, setRecent] = useState<TrainingExperiment[]>([])
  const [models, setModels] = useState<UserModel[]>([])
  const [displayName, setDisplayName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      userProfile(controller.signal).then(value => {
        if (controller.signal.aborted) return null
        setProfile(value)
        setDisplayName(value.displayName ?? '')
        return value
      }),
      userExperiments(controller.signal).catch(() => []),
      userModels(controller.signal).catch(() => []),
    ]).then(([, experiments, ownedModels]) => {
      if (controller.signal.aborted) return
      setRecent(experiments.slice(0, 3))
      setModels(ownedModels)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '个人资料读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired])

  async function saveName(event: FormEvent) {
    event.preventDefault()
    setBusy('name')
    setError('')
    setNotice('')
    try {
      const result = await updateUserProfile(displayName)
      setProfile(value => value ? { ...value, displayName: result.displayName } : value)
      setNotice('显示名称已保存')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '保存失败')
    } finally {
      setBusy('')
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault()
    setBusy('password')
    setError('')
    setNotice('')
    try {
      await changeUserPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setNotice('密码已更新；其他浏览器的登录已失效')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '密码修改失败')
    } finally {
      setBusy('')
    }
  }

  const name = profile?.displayName || profile?.username || ''
  const readyModels = models.filter(modelReady).length
  return <>
    <header className="relative bg-dark px-5 py-4 text-on-dark">
      <div className="flex items-center gap-3 pr-10">
        <span className="grid size-11 shrink-0 place-items-center rounded-md border border-on-dark/15 bg-on-dark/10 font-display text-lg font-semibold text-on-dark" aria-hidden="true">{name ? name.slice(0, 1).toUpperCase() : '·'}</span>
        <div className="grid min-w-0 content-center gap-0.5">
          <DialogTitle className="truncate text-base font-semibold text-on-dark">个人中心</DialogTitle>
          <p className="truncate text-xs text-on-dark-soft">{profile ? `${profile.displayName || profile.username} · @${profile.username}` : ''}</p>
        </div>
      </div>
      <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" className="absolute right-3 top-3 text-on-dark-soft hover:bg-on-dark/10 hover:text-on-dark"><X aria-hidden="true"/></Button></DialogClose>
    </header>
    {!profile ? <div className="p-6">{error
      ? <EmptyState title="个人资料不可用" description={error}/>
      : <LoadingNotice label="正在读取个人资料"/>}</div> : <div className="px-6 pb-6 pt-4">
      <Tabs value={tab} onValueChange={value => { setTab(value); setError(''); setNotice('') }} className="gap-0">
        <TabsList className="grid h-10 w-full grid-cols-2 rounded-md bg-sunken p-1">
          <TabsTrigger value="overview"><UserRound aria-hidden="true"/>概览</TabsTrigger>
          <TabsTrigger value="settings"><KeyRound aria-hidden="true"/>账户设置</TabsTrigger>
        </TabsList>
        {error ? <p className="mt-4 text-xs text-rose" role="alert">{error}</p> : null}
        {notice ? <p className="mt-4 text-xs text-teal-deep" role="status">{notice}</p> : null}
        <TabsContent value="overview" className="grid gap-5 pt-5">
          <div className="flex items-center gap-2 text-xs text-foreground-3"><CalendarDays aria-hidden="true" size={14}/><span>加入于 {dateText(profile.createdAt)}</span></div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              { icon: Database, label: '数据版本', value: profile.datasetCount, route: { name: 'my-data' } as Route },
              { icon: FlaskConical, label: '训练实验', value: profile.experimentCount, route: { name: 'my-training' } as Route },
              { icon: Layers3, label: '模型', value: profile.modelCount, route: { name: 'my-models' } as Route },
            ]).map(item => <button key={item.label} type="button" className="grid min-w-0 gap-2 rounded-md border border-border-soft bg-card p-3 text-left transition-colors hover:bg-hover" onClick={() => { onClose(); navigate(item.route) }}>
              <span className="flex items-center gap-2 text-xs text-foreground-3"><item.icon aria-hidden="true" size={15}/>{item.label}</span>
              <strong className="text-2xl font-semibold tabular-nums text-foreground">{item.value}</strong>
              <span className="flex items-center justify-between text-xs text-foreground-3">查看记录<ChevronRight aria-hidden="true" size={14}/></span>
            </button>)}
          </div>
          <section className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2"><h2 className="text-sm font-semibold text-foreground">最近训练</h2><Button type="button" variant="ghost" size="sm" onClick={() => { onClose(); navigate({ name: 'my-training' }) }}>全部训练<ChevronRight aria-hidden="true"/></Button></div>
            {recent.length ? recent.map(item => <button key={item.experimentId} type="button" className="flex min-w-0 items-center justify-between gap-3 rounded-sm border border-border-soft bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover" onClick={() => { onClose(); navigate({ name: 'my-training', experimentId: item.experimentId }) }}>
              <span className="grid min-w-0 gap-0.5"><strong className="truncate text-sm font-medium text-foreground">{item.datasetVersion}</strong><span className="text-xs text-foreground-3">{item.tasks.length} 个方法 · {item.splitPreset}</span></span>
              <span className="shrink-0 text-xs text-foreground-3">{STATUS_LABELS[item.status] ?? item.status}</span>
            </button>) : <div className="rounded-sm border border-dashed border-border-soft px-3 py-4 text-sm text-foreground-3">还没有训练记录</div>}
          </section>
          <section className="flex items-center justify-between gap-3 rounded-md border border-border-soft bg-card px-3 py-3">
            <div className="grid gap-0.5"><span className="text-sm font-medium text-foreground">模型可用状态</span><span className="text-xs text-foreground-3">{readyModels} 个可用 · {profile.modelCount} 个模型</span></div>
            <Button type="button" variant="ghost" size="sm" onClick={() => { onClose(); navigate({ name: 'my-models' }) }}>查看模型<ChevronRight aria-hidden="true"/></Button>
          </section>
        </TabsContent>
        <TabsContent value="settings" className="grid gap-5 pt-5">
          <form className="grid gap-5" onSubmit={saveName}>
            <label className="grid gap-2">
              <span className="text-xs font-medium text-foreground-2">显示名称</span>
              <Input className="h-10 bg-sunken/60" aria-label="显示名称" maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="留空则显示账户名"/>
            </label>
            <div className="flex justify-end"><Button size="sm" className="min-w-24" type="submit" disabled={Boolean(busy === 'name')}>{busy === 'name' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}保存名称</Button></div>
          </form>
          <div className="border-t border-border-soft pt-5">
          <form className="grid gap-4" onSubmit={savePassword}>
            <label className="grid gap-2"><span className="text-xs font-medium text-foreground-2">当前密码</span>
              <PasswordField className="h-10 bg-sunken/60" aria-label="当前密码" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/>
            </label>
            <label className="grid gap-2"><span className="text-xs font-medium text-foreground-2">新密码</span>
              <PasswordField className="h-10 bg-sunken/60" aria-label="新密码" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)}/>
            </label>
            <div className="flex justify-end"><Button size="sm" className="min-w-24" type="submit" disabled={Boolean(!currentPassword || newPassword.length < 8) || Boolean(busy === 'password')}>{busy === 'password' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}更新密码</Button></div>
          </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>}
  </>
}
