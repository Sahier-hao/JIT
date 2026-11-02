import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import { NotificationEntry } from './components/ProjectActivity'
import { AppearanceControl } from './components/AppearanceControl'
import { Button } from './ui/controls'

export function AppShell({ route, navigate, repositories, children }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; children: ReactNode }) {
  return <div className="app-frame" data-route={route.name}>
    <a className="skip-link" href="#product-main">跳到主要内容</a>
    <aside className="workspace-sidebar">
      <button className="workspace-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-glyph"><Icon name="logo" size={23}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <p className="sidebar-caption">工作空间</p>
      <nav className="main-navigation" aria-label="主导航">
        <button aria-current={route.name !== 'notifications' && (route.name !== 'pr-work' || route.repositoryId) ? 'page' : undefined} onClick={() => navigate({ name: 'repositories' })}><Icon name="project" size={18}/>项目</button>
      </nav>
      {repositories.length ? <div className="sidebar-projects"><p className="sidebar-caption">最近项目</p>{repositories.map(repo => <button key={repo.repositoryId} className="sidebar-project" aria-current={('repositoryId' in route && route.repositoryId === repo.repositoryId) ? 'page' : undefined} onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })}><span className="project-dot"/>{repo.displayName}</button>)}</div> : null}
      <div className="sidebar-bottom"><Button variant="ghost" size="sm" onClick={() => navigate({ name: 'admin', view: 'models' })}><Icon name="sliders"/>管理工作区</Button></div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-topbar"><span className="breadcrumb">工作空间 <span>/</span> <b>{route.name === 'notifications' ? '站内提醒' : route.name === 'my-reviews' ? '我的审查' : route.name === 'pr-work' ? 'PR 审查' : route.name === 'sources' ? '新建项目' : route.name === 'analysis' ? '提交明细' : route.name === 'comparison' ? '分析对比' : '项目'}</b></span><div className="appearance-anchor"><NotificationEntry navigate={navigate}/><AppearanceControl/></div></header>
      <main id="product-main" className="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>
}
