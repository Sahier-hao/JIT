/**
 * 共享应用壳：侧栏、主导航与团队凭据入口（design D1）。
 *
 * 旧工作台与新页面用同一个壳，区别只在 `view`（工作台内部视图）与当前路由高亮。
 */

import type { ReactNode } from 'react'
import { CredentialPanel } from './credentials'
import { Icon } from './Icon'
import type { Route } from './navigation'
import { ROUTE_HASH } from './navigation'
import type { Mode } from './domain'

export interface ShellProps {
  route: Route
  navigate: (route: Route) => void
  mode: Mode
  onMode: (mode: Mode) => void
  view?: string
  count?: number
  onView?: (view: string) => void
}

function NavButton({
  active,
  enabled,
  label,
  icon,
  badge,
  onClick,
}: {
  active: boolean
  enabled: boolean
  label: string
  icon: 'list' | 'shortlist' | 'project' | 'info' | 'plus' | 'search' | 'trend'
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      className={active ? 'nav-item active' : 'nav-item'}
      aria-current={active ? 'page' : undefined}
      disabled={!enabled}
      onClick={onClick}
    >
      <Icon name={icon} />
      {label}
      {badge === undefined ? null : <b>{badge}</b>}
    </button>
  )
}

export function Sidebar({ route, navigate, mode, onMode, view, count = 0, onView }: ShellProps) {
  const onWorkbench = route.name === 'workbench'
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="logo" size={25} />
        </span>
        <div>
          JIT Review<span>提交风险评审</span>
        </div>
      </div>
      <div className="mode-switch" role="group" aria-label="数据模式">
        <button
          aria-label="选择真实历史回放"
          aria-pressed={mode === 'historical'}
          onClick={() => {
            onMode('historical')
            navigate({ name: 'workbench' })
          }}
        >
          历史数据
        </button>
        <button
          aria-label="选择演示模式"
          aria-pressed={mode === 'demo'}
          onClick={() => {
            onMode('demo')
            navigate({ name: 'workbench' })
          }}
        >
          示例数据
        </button>
        <button
          aria-label="选择仓库同步数据"
          aria-pressed={mode === 'repository'}
          onClick={() => onMode('repository')}
        >
          仓库同步
        </button>
      </div>
      <div className="nav-label">工作空间</div>
      <nav aria-label="工作台导航">
        <NavButton
          active={onWorkbench && view === 'list'}
          enabled={onWorkbench && Boolean(onView)}
          icon="list"
          label="提交工作台"
          onClick={() => onView?.('list')}
        />
        <NavButton
          active={route.name === 'trends'}
          enabled
          icon="trend"
          label="历史趋势"
          onClick={() => navigate({ name: 'trends' })}
        />
        <NavButton
          active={onWorkbench && view === 'shortlist'}
          enabled={onWorkbench && Boolean(onView)}
          icon="shortlist"
          label="优先审查清单"
          badge={count}
          onClick={() => onView?.('shortlist')}
        />
        <NavButton
          active={route.name === 'sources'}
          enabled
          icon="project"
          label="数据来源"
          onClick={() => navigate({ name: 'sources' })}
        />
      </nav>
      <div className="nav-label">模型与预测</div>
      <nav aria-label="模型预测导航">
        <NavButton
          active={route.name === 'models'}
          enabled
          icon="project"
          label="模型中心"
          onClick={() => navigate({ name: 'models' })}
        />
        <NavButton
          active={route.name === 'predict'}
          enabled
          icon="plus"
          label="新建预测"
          onClick={() => navigate({ name: 'predict' })}
        />
        <NavButton
          active={route.name === 'open' || route.name === 'result'}
          enabled
          icon="search"
          label="打开已有结果"
          onClick={() => navigate({ name: 'open' })}
        />
      </nav>
      <CredentialPanel />
      <div className="sidebar-foot">
        <div className="workspace-avatar">
          <Icon name="logo" size={18} />
        </div>
        <div>
          个人工作空间<small>清单保存在当前浏览器</small>
        </div>
      </div>
    </aside>
  )
}

export function AppShell({ children, ...shell }: ShellProps & { children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar {...shell} />
      <main className="main">{children}</main>
    </div>
  )
}

/**
 * 未匹配的 hash 路由：给出可返回的入口，不静默当成首页。
 *
 * 只返回页面内容：应用壳由 Workspace 统一渲染一次，页面自己不再嵌套外壳，
 * 这样路由与数据加载都不会重建侧栏（凭据输入与键盘焦点因此保持稳定）。
 */
export function UnknownRoute({ hash, navigate }: { hash: string; navigate: (route: Route) => void }) {
  return (
    <>
      <header className="topbar">JIT · 提交评审 · 未识别的页面</header>
      <div className="empty-state" role="alert">
        <div className="empty-mark">
          <Icon name="info" size={28} />
        </div>
        <h2>未识别的页面地址</h2>
        <p>
          地址 <code>{hash}</code> 不属于本应用的任何页面。
        </p>
        <button className="primary-button" onClick={() => navigate({ name: 'workbench' })}>
          返回提交工作台
        </button>
      </div>
    </>
  )
}

export { ROUTE_HASH }
