/**
 * 外观偏好：主题与密度。
 *
 * 约定（design D10 / IP-05）：
 * - 键名 `jit.theme` / `jit.density`，由 index.html 的内联脚本在首帧前读取，避免闪白。
 * - 存储不可用时静默回落默认值，不阻塞任何功能。
 */
export const THEMES = [
  { id: 'concrete', name: '冷灰', preview: { bg: '#F7F8FA', rail: '#FFFFFF', accent: '#1D4ED8' } },
  { id: 'steel', name: '钢青', preview: { bg: '#F5F7FA', rail: '#FFFFFF', accent: '#1D4ED8' } },
  { id: 'charcoal', name: '炭黑', preview: { bg: '#0B1120', rail: '#070C16', accent: '#7BA3F7' } },
  { id: 'paper', name: '纸墨', preview: { bg: '#FAFAFA', rail: '#FFFFFF', accent: '#333333' } },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
export type DensityId = 'comfortable' | 'compact'

export const THEME_KEY = 'jit.theme'
export const DENSITY_KEY = 'jit.density'
export const SIDEBAR_KEY = 'jit.sidebar'

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 存储不可用：偏好不持久化，但不影响本次使用（IP-05 场景）
  }
}

/** 应用到文档根节点；主题与密度都以 data 属性驱动 CSS。 */
export function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme
}

export function applyDensity(density: string): void {
  document.documentElement.dataset.density = density
}

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function initialTheme(): ThemeId {
  const stored = readStored(THEME_KEY)
  return isThemeId(stored) ? stored : 'concrete'
}

export function initialDensity(): DensityId {
  return readStored(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
}
