import { type LucideIcon, BookOpenText, ClipboardCheck, CodeXml, Folder, List, TrendingUp, SlidersHorizontal, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceNavigation } from '@/components/layout/WorkspaceNavigation'
import { BrandLogo } from '@/components/shared/BrandLogo'
import type { ReactNode } from 'react'

import { linkTo, repositoryRoute, type Route } from '@/app/navigation'
import { projectsNavActive } from '@/components/layout/navActive'
import type { RepositoryView } from '@/features/projects/repositoryWorkspace'
import type { UserSession } from '@/features/account/userClient'
import { NotificationEntry } from '@/features/projects/components/ProjectActivity'
import { AppearanceControl } from '@/components/layout/AppearanceControl'
import { ActiveJobsIndicator } from '@/components/layout/ActiveJobsIndicator'
import { useActiveUserJobs } from '@/features/account/activeJobs'
import { UserAccount } from '@/features/account/components/UserAccount'
import { cn } from '@/lib/utils'

const NAV: { label: string; items: { label: string; icon: LucideIcon; route: Route }[] }[] = [
  { label: '审查', items: [
    { label: '项目', icon: Folder, route: { name: 'repositories' } },
    { label: '我的审查', icon: ClipboardCheck, route: { name: 'my-reviews' } },
    { label: 'IDE 插件', icon: CodeXml, route: { name: 'ide-plugin' } },
  ] },
  { label: '数据与模型', items: [
    { label: '我的数据', icon: List, route: { name: 'my-data' } },
    { label: '我的训练', icon: TrendingUp, route: { name: 'my-training' } },
    { label: '算法库', icon: BookOpenText, route: { name: 'algorithms' } },
    { label: '我的模型', icon: SlidersHorizontal, route: { name: 'my-models' } },
    { label: '模型试算', icon: Gauge, route: { name: 'my-predictions' } },
  ] },
]

export function AppShell({ route, navigate, repositories, session, onSession, children }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; session: UserSession | null; onSession: (session: UserSession) => void; children: ReactNode }) {
  const activeJobs = useActiveUserJobs(session?.username ?? null)
  const label = route.name === 'notifications' ? '站内提醒' : route.name === 'my-reviews' ? '我的审查'
    : route.name === 'my-data' ? '我的数据' : route.name === 'my-training' ? '我的训练'
    : route.name === 'algorithms' ? '算法库' : route.name === 'ide-plugin' ? 'IDE 插件' : route.name === 'my-models' ? '我的模型' : route.name === 'profile' ? '个人中心' : route.name === 'pr-work' ? 'PR 审查'
    : route.name === 'my-predictions' ? '模型试算'
    : route.name === 'sources' ? '新建项目' : route.name === 'analysis' ? '提交明细'
    : route.name === 'comparison' ? '分析对比' : '项目'
  const projectsActive = projectsNavActive(route)
  const primaryNav = <nav className="grid gap-2" aria-label="主导航">
    {NAV.map(group => <div key={group.label} className="grid gap-0.5">
      <p className="mt-1 px-3 pb-0.5 text-xs font-medium text-foreground-4">{group.label}</p>
      {group.items.map(item => {
        const active = item.route.name === 'repositories' ? projectsActive
          : route.name === item.route.name || (item.route.name === 'my-reviews' && route.name === 'pr-work' && !route.repositoryId)
        return <Button variant="ghost" size="sm" asChild key={item.label}
          className="flex h-9 min-w-0 justify-start gap-2 rounded-sm px-3 text-sm text-foreground-2 aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground">
          <a {...linkTo(item.route, navigate)} aria-current={active ? 'page' : undefined}>
            <item.icon aria-hidden="true" size={16} className={cn('opacity-60', active && 'opacity-90')}/>{item.label}
          </a>
        </Button>
      })}
    </div>)}
  </nav>
  return <div className="min-h-screen bg-background lg:grid lg:grid-cols-[220px_minmax(0,1fr)]" data-route={route.name}>
    <a className="sr-only z-[100] rounded-sm border border-border bg-card px-3.5 py-2.5 text-sm text-foreground focus:not-sr-only focus:fixed focus:left-2.5 focus:top-2.5"
      href="#product-main" onClick={event => { event.preventDefault(); document.getElementById('product-main')?.focus() }}>跳到主要内容</a>
    <aside className="hidden border-r border-border bg-rail lg:sticky lg:top-0 lg:block lg:h-dvh lg:self-start lg:overflow-hidden">
      <div className="flex h-full flex-col px-3.5 py-4">
        <Button variant="ghost" type="button" className="h-auto flex justify-start items-center gap-3 border-0 border-b border-border-soft bg-transparent px-2 pb-3.5 text-left" onClick={() => navigate({ name: 'repositories' })}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><BrandLogo aria-hidden="true" focusable="false" strokeWidth={1.5} size={18}/></span>
          <span className="flex flex-col leading-none"><span className="font-display text-xl font-bold tracking-tight text-foreground">JIT</span><span className="mt-1 font-mono text-[10px] font-medium tracking-[.13em] text-foreground-4">REVIEW</span></span>
        </Button>

        <div className="mt-3">{primaryNav}</div>

        {repositories.length ? <div className="mt-6 hidden min-h-0 flex-1 overflow-y-auto sm:block">
          <p className="px-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[.14em] text-foreground-4">最近项目</p>
          {repositories.map(repo => {
            const active = 'repositoryId' in route && route.repositoryId === repo.repositoryId
            return <Button variant="ghost"
              key={repo.repositoryId}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(repositoryRoute(repo.repositoryId))}
              className="flex h-8 w-full items-center justify-start gap-2.5 rounded-sm border-0 bg-transparent px-3 text-left text-sm text-foreground-2 hover:bg-hover hover:text-foreground aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            ><span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-accent' : 'bg-foreground-4')}/><span className="truncate">{repo.displayName}</span></Button>
          })}
        </div> : null}
      </div>
    </aside>

    <div className="min-w-0">
      <header className="sticky top-0 z-30 flex min-h-12 min-w-0 items-center justify-between gap-2 border-b border-border-soft bg-card px-3 py-1.5 sm:min-h-14 sm:px-6">
        <WorkspaceNavigation label={label}>{primaryNav}</WorkspaceNavigation>
        <span className="hidden min-w-0 truncate text-xs font-medium text-foreground-3 lg:inline">工作空间 <span className="opacity-60">/</span> <b className="font-medium text-foreground">{label}</b></span>
        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2"><ActiveJobsIndicator jobs={activeJobs} navigate={navigate}/><UserAccount session={session} onChange={onSession} navigate={navigate} route={route}/><NotificationEntry navigate={navigate}/><AppearanceControl/></div>
      </header>
      <main id="product-main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-page-x py-6 pb-14 outline-none max-[640px]:px-page-x-narrow">{children}</main>
    </div>
  </div>
}
