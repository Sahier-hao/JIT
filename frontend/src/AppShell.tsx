import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'
import { EmptyState } from './Feedback'
import { hashFor, type Route } from './navigation'
import type { RepositoryView } from './repositoryWorkspace'
import { initialTheme, initialDensity, applyTheme, applyDensity } from './preferences'
export { ROUTE_HASH } from './navigation'

export interface ShellProps {
  route: Route; navigate: (route: Route) => void
  repositories: RepositoryView[]; repositoriesState: 'idle' | 'loading' | 'ready' | 'error'
  selectedRepositoryId: string | null; shortlistCount: number
  repositoryTarget?: Route | null
}
export function AppShell({ children, ...shell }: ShellProps & { children: ReactNode }) {
  const { route, navigate, repositoryTarget } = shell
  const lab = ['history','demo','validation','trends','models','predict','open','result'].includes(route.name)
  const settings = route.name === 'settings'
  useEffect(() => { applyTheme(initialTheme()); applyDensity(initialDensity()) }, [])
  const target = route.name === 'analysis' ? route : repositoryTarget
  const link = (label: string, destination: Route, active = false) => <button className="space-link" aria-current={active ? 'page' : undefined} onClick={() => navigate(destination)}>{label}</button>
  return <div className="product-shell">
    <a className="skip-link" href="#product-main">跳到主要内容</a>
    <aside className="product-rail" aria-label="空间导航">
      <button className="product-brand" onClick={() => navigate({ name: 'repositories' })}><span className="brand-symbol">J</span><span>JIT Review<small>看清改动，安排审查</small></span></button>
      <div className="space-switch" aria-label="产品空间">
        {link('项目工作区', repositoryTarget ?? { name: 'repositories' }, !lab && !settings)}
        {link('实验室', { name: 'validation' }, lab)}
        {link('设置', { name: 'settings', page: 'connection', returnTo: hashFor(route) }, settings)}
      </div>
      <nav className="product-nav" aria-label="当前空间">
        {settings ? <>
          <p className="side-label">设置</p>
          {link('团队连接', { name: 'settings', page: 'connection', ...(route.name === 'settings' ? { returnTo: route.returnTo } : {}) }, route.name === 'settings' && route.page === 'connection')}
          {link('外观与阅读', { name: 'settings', page: 'appearance', ...(route.name === 'settings' ? { returnTo: route.returnTo } : {}) }, route.name === 'settings' && route.page === 'appearance')}
        </> : lab ? <>
          <p className="side-label">实验与验证</p>
          {link('历史验证', { name: 'validation' }, ['history','validation','trends'].includes(route.name))}
          {link('模型目录', { name: 'models' }, route.name === 'models')}
          {link('手工预测', { name: 'predict' }, route.name === 'predict')}
          {link('重开已存结果', { name: 'open' }, route.name === 'open' || route.name === 'result')}
          {link('交互演示', { name: 'demo' }, route.name === 'demo')}
          <p className="rail-note">历史验证、手工输入与演示各自保留来源；模型分数用于排序。</p>
        </> : <>
          <p className="side-label">项目</p>
          {link('全部项目', { name: 'repositories' }, route.name === 'repositories' || route.name === 'workbench')}
          {link('接入仓库', { name: 'sources' }, route.name === 'sources')}
          {target?.name === 'analysis' ? <>
            <p className="side-label">当前分析</p>
            {link('已分析提交', { ...target, view: 'commits', commitId: undefined }, route.name === 'analysis' && route.view === 'commits')}
            {link('审查计划', { ...target, view: 'plan', commitId: undefined }, route.name === 'analysis' && route.view === 'plan')}
          </> : null}
          <p className="side-label">切换仓库</p>
          <div className="repository-switcher">{shell.repositories.map(item => <button className="space-link repo-switch" key={item.repositoryId} aria-current={item.repositoryId === shell.selectedRepositoryId ? 'true' : undefined} onClick={() => navigate({ name: 'repository', repositoryId: item.repositoryId })}><Icon name="project" size={16}/><span>{item.displayName}</span></button>)}</div>
          {shell.repositoriesState === 'error' ? <p className="rail-note">仓库列表读取失败，请在全部项目页重试。</p> : null}
        </>}
      </nav>
      <footer className="product-rail-foot"><span className="connection-dot"/>本机工作空间<span>UTC+08:00</span></footer>
    </aside>
    <div className="product-content"><header className="product-topbar"><span>{settings ? '设置' : lab ? '实验室' : '项目工作区'}</span><span>{lab ? '验证 · 理解 · 复用' : settings ? '连接与阅读偏好' : '提交审查与个人计划'}</span></header><main id="product-main" className="product-main" tabIndex={-1}>{children}</main></div>
  </div>
}
export function UnknownRoute({ hash, navigate }: { hash: string; navigate: (route: Route) => void }) {
  return <EmptyState title="未识别的页面地址" description={<>地址 <code>{hash}</code> 无法定位对象。</>}><button className="primary-button" onClick={() => navigate({ name: 'repositories' })}>返回全部项目</button></EmptyState>
}
