import { useState } from 'react'
import { CredentialPanel } from './credentials'
import { THEMES, initialTheme, initialDensity, applyTheme, applyDensity, writeStored, THEME_KEY, DENSITY_KEY } from './preferences'
import { parseHash, type Route } from './navigation'

export function SettingsPage({ route, navigate }: { route: Extract<Route, { name: 'settings' }>; navigate: (route: Route) => void }) {
  const [theme, setTheme] = useState(initialTheme)
  const [density, setDensity] = useState(initialDensity)
  return <section className="settings-page stack"><header className="page-heading"><div><p className="eyebrow">工作空间设置</p><h1>{route.page === 'connection' ? '团队连接' : '外观与阅读'}</h1><p className="page-intro">{route.page === 'connection' ? '凭据只保存在当前页面内存中，关闭或刷新后需要重新输入。' : '选择适合你的阅读环境，密度只调整间距。'}</p></div><button className="clear-button" onClick={() => navigate(route.returnTo ? parseHash(route.returnTo) : { name: 'repositories' })}>返回之前页面</button></header>
    {route.page === 'connection' ? <div className="settings-card"><CredentialPanel/><p className="muted">成员可访问仓库、模型与预测。管理员另可登记模型；公开历史验证无需凭据。</p></div> : <div className="settings-card"><h2>界面主题</h2><div className="theme-grid" role="group" aria-label="界面主题">{THEMES.map(item => <button className="theme-tile" key={item.id} aria-pressed={theme === item.id} onClick={() => { setTheme(item.id); applyTheme(item.id); writeStored(THEME_KEY, item.id) }}><span className="theme-preview" style={{ background: item.preview.bg, borderColor: item.preview.accent }}/>{item.name}</button>)}</div><h2>表格密度</h2><div className="density-choice" role="group" aria-label="表格密度">{(['comfortable', 'compact'] as const).map(id => <button key={id} aria-pressed={density === id} onClick={() => { setDensity(id); applyDensity(id); writeStored(DENSITY_KEY, id) }}>{id === 'compact' ? '紧凑' : '舒适'}</button>)}</div></div>}
  </section>
}
