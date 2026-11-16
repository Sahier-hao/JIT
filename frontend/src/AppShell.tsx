import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { repositoryRoute, type Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import type { UserSession } from './userClient'
import { NotificationEntry } from './components/ProjectActivity'
import { AppearanceControl } from './components/AppearanceControl'
import { UserAccount } from './components/UserAccount'
import { cn } from './lib/utils'

const NAV: { label: string; icon: IconName; route: Route }[] = [
  { label: '项目', icon: 'project', route: { name: 'repositories' } },
  { label: '我的数据', icon: 'list', route: { name: 'my-data' } },
  { label: '我的训练', icon: 'trend', route: { name: 'my-training' } },
  { label: '我的模型', icon: 'sliders', route: { name: 'my-models' } },
  { label: '个人空间', icon: 'user', route: { name: 'profile' } },
]

export function AppShell({ route, navigate, repositories, session, onSession, children }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; session: UserSession | null; onSession: (session: UserSession) => void; children: ReactNode }) {
  const label = route.name === 'notifications' ? '站内提醒' : route.name === 'my-reviews' ? '我的审查'
    : route.name === 'my-data' ? '我的数据' : route.name === 'my-training' ? '我的训练'
    : route.name === 'my-models' ? '我的模型' : route.name === 'profile' ? '个人空间' : route.name === 'pr-work' ? 'PR 审查'
    : route.name === 'sources' ? '新建项目' : route.name === 'analysis' ? '提交明细'
    : route.name === 'comparison' ? '分析对比' : '项目'
  const projectsActive = route.name !== 'notifications' && (route.name !== 'pr-work' || Boolean(route.repositoryId))
  return <div className="min-h-screen bg-background sm:grid sm:grid-cols-[236px_minmax(0,1fr)]" data-route={route.name}>
    <a className="fixed left-2.5 top-[-60px] z-[100] rounded-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:top-2.5" href="#product-main">跳到主要内容</a>
    <aside className="border-b border-border bg-rail sm:border-b-0 sm:border-r">
      <div className="flex h-full flex-col px-3.5 py-4">
        <button type="button" className="flex items-center gap-3 border-0 border-b border-border-soft bg-transparent px-2 pb-3.5 text-left" onClick={() => navigate({ name: 'repositories' })}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Icon name="logo" size={18}/></span>
          <span className="flex flex-col leading-none"><span className="font-display text-xl font-bold tracking-tight text-foreground">JIT</span><span className="mt-1 font-mono text-[10px] font-medium tracking-[.13em] text-foreground-4">REVIEW</span></span>
        </button>

        <p className="mb-2 mt-4 hidden px-3 text-xs font-medium tracking-wide text-foreground-4 sm:block">工作空间</p>
        <nav className="flex gap-1 overflow-x-auto sm:grid" aria-label="主导航">
          {NAV.map(item => {
            const active = item.route.name === 'repositories' ? projectsActive : route.name === item.route.name
            return <button
              key={item.label}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.route)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2.5 rounded-sm border-0 bg-transparent px-3 text-sm text-foreground-2 transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground',
              )}
            ><Icon name={item.icon} size={18} className={cn('opacity-60', active && 'opacity-90')}/>{item.label}</button>
          })}
        </nav>

        {repositories.length ? <div className="mt-6 hidden sm:block">
          <p className="px-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-foreground-4">最近项目</p>
          {repositories.map(repo => {
            const active = 'repositoryId' in route && route.repositoryId === repo.repositoryId
            return <button
              key={repo.repositoryId}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(repositoryRoute(repo.repositoryId))}
              className="flex h-8 w-full items-center gap-2.5 rounded-sm border-0 bg-transparent px-3 text-left text-sm text-foreground-2 hover:bg-hover hover:text-foreground aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            ><span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-accent' : 'bg-foreground-4')}/><span className="truncate">{repo.displayName}</span></button>
          })}
        </div> : null}
      </div>
    </aside>

    <div className="min-w-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-border bg-background px-5 sm:h-13 sm:px-6">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[.1em] text-foreground-4">工作空间 <span className="opacity-60">/</span> <b className="font-medium text-foreground">{label}</b></span>
        <div className="flex items-center gap-1.5"><UserAccount session={session} onChange={onSession} navigate={navigate}/><NotificationEntry navigate={navigate}/><AppearanceControl/></div>
      </header>
      <main id="product-main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-page-x py-6 pb-14 outline-none max-[640px]:px-page-x-narrow">{children}</main>
    </div>
  </div>
}
