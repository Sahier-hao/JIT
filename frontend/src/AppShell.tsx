import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import type { Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import { NotificationEntry } from './components/ProjectActivity'
import { Popover } from './ui/popover'
import { Button, IconButton } from './ui/controls'
import { THEMES, initialTheme, initialDensity, applyTheme, applyDensity, writeStored, THEME_KEY, DENSITY_KEY, type ThemeId } from './preferences'

export function AppShell({ route, navigate, repositories, children }: { route: Route; navigate: (route: Route) => void; repositories: RepositoryView[]; children: ReactNode }) {
  const [appearance, setAppearance] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(initialTheme)
  const [density, setDensity] = useState(initialDensity)
  const report = route.name === 'report' || route.name === 'admin'
  function chooseTheme(id: ThemeId) {
    setTheme(id)
    applyTheme(id)
    writeStored(THEME_KEY, id)
  }
  return <div className="app-frame" data-route={route.name}>
    <a className="skip-link" href="#product-main">跳到主要内容</a>
    <aside className="workspace-sidebar">
      <button className="workspace-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-glyph"><Icon name="logo" size={23}/></span><span>JIT<span className="brand-caption">REVIEW</span></span></button>
      <p className="sidebar-caption">工作空间</p>
      <nav className="main-navigation" aria-label="主导航">
        <button aria-current={!report && route.name !== 'notifications' && (route.name !== 'pr-work' || route.repositoryId) ? 'page' : undefined} onClick={() => navigate({ name: 'repositories' })}><Icon name="project" size={18}/>项目</button>
      </nav>
      {repositories.length ? <div className="sidebar-projects"><p className="sidebar-caption">最近项目</p>{repositories.map(repo => <button key={repo.repositoryId} className="sidebar-project" aria-current={('repositoryId' in route && route.repositoryId === repo.repositoryId) ? 'page' : undefined} onClick={() => navigate({ name: 'repository', repositoryId: repo.repositoryId })}><span className="project-dot"/>{repo.displayName}</button>)}</div> : null}
      <div className="sidebar-bottom"><Button variant="ghost" size="sm" aria-current={report ? 'page' : undefined} onClick={() => navigate({ name: 'admin', view: 'models' })}><Icon name="sliders"/>管理工作区</Button></div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-topbar"><span className="breadcrumb">{report ? '管理工作区' : '工作空间'} <span>/</span> <b>{route.name === 'report' ? '验证报告' : route.name === 'admin' ? route.view === 'models' ? '模型管理' : '数据记录' : route.name === 'notifications' ? '站内提醒' : route.name === 'my-reviews' ? '我的审查' : route.name === 'pr-work' ? 'PR 审查' : route.name === 'sources' ? '新建项目' : route.name === 'analysis' ? '提交明细' : route.name === 'comparison' ? '分析对比' : '项目'}</b></span><div className="appearance-anchor"><NotificationEntry navigate={navigate}/><Popover
        label="外观偏好"
        open={appearance}
        onOpenChange={setAppearance}
        trigger={<IconButton label="外观偏好" aria-expanded={appearance} icon={<Icon name="sliders" size={18}/>}/>}
      >
        <div className="appearance-popover"><strong>外观偏好</strong>
          <div role="group" aria-label="主题">{THEMES.map(item => <button key={item.id} aria-pressed={theme === item.id} data-theme-option={item.id} onClick={() => chooseTheme(item.id)}>{item.name}</button>)}</div>
          <div role="group" aria-label="阅读密度"><button aria-pressed={density === 'comfortable'} onClick={() => { setDensity('comfortable'); applyDensity('comfortable'); writeStored(DENSITY_KEY, 'comfortable') }}>舒适</button><button aria-pressed={density === 'compact'} onClick={() => { setDensity('compact'); applyDensity('compact'); writeStored(DENSITY_KEY, 'compact') }}>紧凑</button></div>
        </div>
      </Popover></div></header>
      <main id="product-main" className="workspace-main" tabIndex={-1}>{children}</main>
    </div>
  </div>
}
