import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { repositoryRoute, type Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import type { UserSession } from './userClient'
import { NotificationEntry } from './components/ProjectActivity'
import { AppearanceControl } from './components/AppearanceControl'
import { UserAccount } from './components/UserAccount'

export function AppShell({ route, navigate, repositories, session, onSession, children }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; session: UserSession | null; onSession: (session: UserSession) => void; children: ReactNode }) {
  const label = route.name === 'notifications' ? '站内提醒' : route.name === 'my-reviews' ? '我的审查'
    : route.name === 'my-data' ? '我的数据' : route.name === 'my-training' ? '我的训练'
    : route.name === 'my-models' ? '我的模型' : route.name === 'profile' ? '个人空间' : route.name === 'pr-work' ? 'PR 审查'
    : route.name === 'sources' ? '新建项目' : route.name === 'analysis' ? '提交明细'
    : route.name === 'comparison' ? '分析对比' : '项目'
  return <div className="app-frame" data-route={route.name}>
    <a className="skip-link" href="#product-main">跳到主要内容</a>
    <aside className="workspace-sidebar">
      <button className="workspace-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-glyph"><Icon name="logo" size={23}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <p className="sidebar-caption">工作空间</p>
      <nav className="main-navigation" aria-label="主导航">
        <button aria-current={route.name !== 'notifications' && (route.name !== 'pr-work' || route.repositoryId) ? 'page' : undefined} onClick={() => navigate({ name: 'repositories' })}><Icon name="project" size={18}/>项目</button>
        <button aria-current={route.name === 'my-data' ? 'page' : undefined} onClick={() => navigate({ name: 'my-data' })}><Icon name="list" size={18}/>我的数据</button>
        <button aria-current={route.name === 'my-training' ? 'page' : undefined} onClick={() => navigate({ name: 'my-training' })}><Icon name="trend" size={18}/>我的训练</button>
        <button aria-current={route.name === 'my-models' ? 'page' : undefined} onClick={() => navigate({ name: 'my-models' })}><Icon name="sliders" size={18}/>我的模型</button>
        <button aria-current={route.name === 'profile' ? 'page' : undefined} onClick={() => navigate({ name: 'profile' })}><Icon name="user" size={18}/>个人空间</button>
      </nav>
      {repositories.length ? <div className="sidebar-projects"><p className="sidebar-caption">最近项目</p>{repositories.map(repo => <button key={repo.repositoryId} className="sidebar-project" aria-current={('repositoryId' in route && route.repositoryId === repo.repositoryId) ? 'page' : undefined} onClick={() => navigate(repositoryRoute(repo.repositoryId))}><span className="project-dot"/>{repo.displayName}</button>)}</div> : null}
    </aside>
    <div className="workspace-content">
      <header className="workspace-topbar"><span className="breadcrumb">工作空间 <span>/</span> <b>{label}</b></span><div className="appearance-anchor"><UserAccount session={session} onChange={onSession} navigate={navigate}/><NotificationEntry navigate={navigate}/><AppearanceControl/></div></header>
      <main id="product-main" className="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>
}
