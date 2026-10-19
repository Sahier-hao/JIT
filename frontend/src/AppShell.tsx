import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import type { Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import { initialTheme, initialDensity, applyTheme, applyDensity, writeStored, THEME_KEY, DENSITY_KEY } from './preferences'

export function AppShell({ route, navigate, repositories, children, recentAnalysis }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; children: ReactNode; recentAnalysis: Extract<Route, { name: 'analysis' }> | null }) {
  const [appearance, setAppearance] = useState(false)
  const [theme, setTheme] = useState(initialTheme)
  const [density, setDensity] = useState(initialDensity)
  const report = route.name === 'report'
  return <div className="app-frame">
    <a className="skip-link" href="#product-main">跳到主要内容</a>
    <aside className="workspace-sidebar">
      <button className="workspace-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-glyph"><Icon name="logo" size={23}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <p className="sidebar-caption">工作空间</p>
      <nav className="main-navigation" aria-label="主导航">
        <button aria-current={!report ? 'page' : undefined} onClick={() => navigate({ name: 'repositories' })}><Icon name="project" size={18}/>项目</button>
        <button aria-current={report ? 'page' : undefined} onClick={() => navigate({ name: 'report', view: 'overview' })}><Icon name="trend" size={18}/>验证报告</button>
      </nav>
      {repositories.length ? <div className="sidebar-projects"><p className="sidebar-caption">最近项目</p>{repositories.map(repo => <button key={repo.repositoryId} className="sidebar-project" aria-current={('repositoryId' in route && route.repositoryId === repo.repositoryId) ? 'page' : undefined} onClick={() => navigate(recentAnalysis?.repositoryId === repo.repositoryId ? recentAnalysis : { name: 'repository', repositoryId: repo.repositoryId })}><span className="project-dot"/>{repo.displayName}</button>)}</div> : null}
      <div className="sidebar-bottom"><span className="local-indicator"/>本机工作空间<span>v0.2</span></div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-topbar"><span className="breadcrumb">工作空间 <span>/</span> <b>{report ? '验证报告' : route.name === 'sources' ? '新建分析' : route.name === 'analysis' ? '提交审查' : '项目'}</b></span><div className="appearance-anchor"><button className="icon-button" aria-label="外观偏好" aria-expanded={appearance} onClick={() => setAppearance(!appearance)}><Icon name="sliders" size={18}/></button>{appearance ? <div className="appearance-popover"><strong>外观偏好</strong><div role="group" aria-label="主题"><button aria-pressed={theme !== 'charcoal'} onClick={() => { setTheme('concrete'); applyTheme('concrete'); writeStored(THEME_KEY, 'concrete') }}>浅色</button><button aria-pressed={theme === 'charcoal'} onClick={() => { setTheme('charcoal'); applyTheme('charcoal'); writeStored(THEME_KEY, 'charcoal') }}>深色</button></div><div role="group" aria-label="阅读密度"><button aria-pressed={density === 'comfortable'} onClick={() => { setDensity('comfortable'); applyDensity('comfortable'); writeStored(DENSITY_KEY, 'comfortable') }}>舒适</button><button aria-pressed={density === 'compact'} onClick={() => { setDensity('compact'); applyDensity('compact'); writeStored(DENSITY_KEY, 'compact') }}>紧凑</button></div></div> : null}</div></header>
      <main id="product-main" className="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>
}
