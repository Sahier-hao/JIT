/**
 * 共享应用壳：图标轨 + 上下文栏 + 设置面板。
 *
 * 分层（design D7）：52px 图标轨放主导航，188px 上下文栏放模式切换、分组导航与凭据。
 * 团队凭据输入保留在侧栏（MPW-02），设置面板只承载外观偏好。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CredentialPanel } from './credentials'
import { Icon, type IconName } from './Icon'
import { EmptyState } from './Feedback'
import type { Route } from './navigation'
import { ROUTE_HASH } from './navigation'
import type { Mode } from './domain'
import { SIDEBAR_KEY, initialTheme, initialDensity, applyTheme, applyDensity, readStored, writeStored } from './preferences'
import { Settings } from './Settings'

export interface ShellProps {
  route: Route
  navigate: (route: Route) => void
  mode: Mode
  onMode: (mode: Mode) => void
  view?: string
  count?: number
  onView?: (view: string) => void
}

type SidebarMode = 'expanded' | 'rail'

interface NavSpec {
  active: boolean
  enabled: boolean
  label: string
  icon: IconName
  badge?: number
  onClick: () => void
}

/**
 * 图标轨上的导航是上下文栏的**指针快捷方式**：同一目的地在页面里只保留一个
 * 可访问名称（上下文栏里的那一项），因此这里整体移出可访问性树并从 Tab 序列移除。
 * 键盘用户通过上下文栏完成全部导航（CRR-12）。
 */
function railButton(spec: NavSpec) {
  return (
    <button
      key={spec.label}
      className="rail-btn"
      title={spec.label}
      aria-hidden="true"
      tabIndex={-1}
      disabled={!spec.enabled}
      onClick={spec.onClick}
    >
      <Icon name={spec.icon} />
    </button>
  )
}

function ctxItem(spec: NavSpec) {
  return (
    <button
      key={spec.label}
      className="ctx-item"
      aria-current={spec.active ? 'page' : undefined}
      disabled={!spec.enabled}
      onClick={spec.onClick}
    >
      <Icon name={spec.icon} />
      <span>{spec.label}</span>
      {spec.badge === undefined ? null : <b>{spec.badge}</b>}
    </button>
  )
}

export function Sidebar({
  route,
  navigate,
  mode,
  onMode,
  view,
  count = 0,
  onView,
  onOpenSettings,
  sidebar,
  onToggleSidebar,
}: ShellProps & {
  onOpenSettings: () => void
  sidebar: SidebarMode
  onToggleSidebar: () => void
}) {
  const onWorkbench = route.name === 'workbench'
  const canView = onWorkbench && Boolean(onView)

  const workspace: NavSpec[] = [
    {
      active: onWorkbench && view === 'list',
      enabled: canView,
      label: '提交工作台',
      icon: 'list',
      onClick: () => onView?.('list'),
    },
    {
      active: route.name === 'trends',
      enabled: true,
      label: '历史趋势',
      icon: 'trend',
      onClick: () => navigate({ name: 'trends' }),
    },
    {
      active: onWorkbench && view === 'shortlist',
      enabled: canView,
      label: '优先审查清单',
      icon: 'shortlist',
      badge: count,
      onClick: () => onView?.('shortlist'),
    },
  ]

  const models: NavSpec[] = [
    {
      active: route.name === 'models',
      enabled: true,
      label: '模型中心',
      icon: 'project',
      onClick: () => navigate({ name: 'models' }),
    },
    {
      active: route.name === 'predict',
      enabled: true,
      label: '新建预测',
      icon: 'plus',
      onClick: () => navigate({ name: 'predict' }),
    },
    {
      active: route.name === 'open' || route.name === 'result',
      enabled: true,
      label: '打开已有结果',
      icon: 'search',
      onClick: () => navigate({ name: 'open' }),
    },
  ]

  return (
    <>
      <nav className="rail" aria-label="主导航">
        <span className="rail-mark" aria-hidden="true">JIT</span>
        <button
          className="rail-btn"
          aria-label={sidebar === 'expanded' ? '收起侧栏' : '展开侧栏'}
          title={sidebar === 'expanded' ? '收起侧栏' : '展开侧栏'}
          aria-expanded={sidebar === 'expanded'}
          onClick={onToggleSidebar}
        >
          <Icon name={sidebar === 'expanded' ? 'collapse' : 'chevron'} />
        </button>
        <span className="rail-rule" aria-hidden="true" />
        {workspace.map(railButton)}
        <span className="rail-rule" aria-hidden="true" />
        {models.map(railButton)}
        <span className="rail-gap" />
        <button className="rail-btn" aria-label="设置" title="设置" onClick={onOpenSettings}>
          <Icon name="sliders" />
        </button>
      </nav>

      <aside className="context" aria-label="工作空间" aria-hidden={sidebar === 'rail'}>
        <div className="ctx-brand">
          <div className="brand">
            <div className="wordmark">JIT Review</div>
            <span className="brand-sub">提交风险评审</span>
          </div>
        </div>

        <div className="mode-switch segmented" role="group" aria-label="数据模式">
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
        </div>

        <p className="nav-label">工作空间</p>
        {workspace.map(ctxItem)}
        <p className="nav-label">模型与预测</p>
        {models.map(ctxItem)}

        <div className="ctx-foot">
          <CredentialPanel />
        </div>
      </aside>
    </>
  )
}

export function AppShell({ children, ...shell }: ShellProps & { children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebar, setSidebar] = useState<SidebarMode>(() => (readStored(SIDEBAR_KEY) === 'rail' ? 'rail' : 'expanded'))
  const trigger = useRef<HTMLElement | null>(null)

  // 首帧由 index.html 的内联脚本写入；这里补齐运行期兜底与数据属性同步
  useEffect(() => {
    applyTheme(document.documentElement.dataset.theme ?? initialTheme())
    applyDensity(document.documentElement.dataset.density ?? initialDensity())
  }, [])

  useEffect(() => {
    document.documentElement.dataset.sidebar = sidebar
    writeStored(SIDEBAR_KEY, sidebar)
  }, [sidebar])

  const openSettings = useCallback((event?: { currentTarget?: HTMLElement | null }) => {
    trigger.current = event?.currentTarget ?? null
    setSettingsOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    trigger.current?.focus()
  }, [])

  return (
    <div className="app">
      <Sidebar
        {...shell}
        sidebar={sidebar}
        onToggleSidebar={() => setSidebar(sidebar === 'expanded' ? 'rail' : 'expanded')}
        onOpenSettings={openSettings}
      />
      <main className="main">{children}</main>
      {settingsOpen ? <Settings onClose={closeSettings} /> : null}
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
      <EmptyState
        tone="alert"
        title="未识别的页面地址"
        description={
          <>
            地址 <code>{hash}</code> 不属于本应用的任何页面。
          </>
        }
      >
        <button className="primary-button" onClick={() => navigate({ name: 'workbench' })}>
          返回提交工作台
        </button>
      </EmptyState>
    </>
  )
}

export { ROUTE_HASH }
