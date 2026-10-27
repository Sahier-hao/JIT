import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect, useState, type ReactNode } from 'react'

/**
 * antd 主题桥：组件的色值全部从 tokens.css 的 CSS 变量读取，
 * 切换 data-theme 时重新读一次，避免两套设计系统各说各话。
 */
function readTokens() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    dark: document.documentElement.dataset.theme === 'charcoal',
    canvas: read('--canvas', '#f7f8fa'),
    card: read('--card', '#ffffff'),
    sunken: read('--sunken', '#f1f4f8'),
    fg: read('--fg', '#0e1524'),
    fg2: read('--fg-2', '#3a4554'),
    fg3: read('--fg-3', '#5c6675'),
    line: read('--line', '#edeff3'),
    lineStrong: read('--line-strong', '#dce1e9'),
    accent: read('--accent', '#277452'),
    accentSoft: read('--accent-soft', '#eaf3ed'),
    btn: read('--btn', '#0e1524'),
    risk: read('--risk', '#b7791f'),
    riskHigh: read('--risk-high', '#b42318'),
    sans: read('--sans', 'system-ui, sans-serif'),
  }
}

export function AntdProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState(readTokens)
  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readTokens()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: tokens.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: tokens.accent,
          colorInfo: tokens.accent,
          colorLink: tokens.accent,
          colorSuccess: tokens.accent,
          colorWarning: tokens.risk,
          colorError: tokens.riskHigh,
          colorText: tokens.fg,
          colorTextSecondary: tokens.fg2,
          colorTextTertiary: tokens.fg3,
          colorTextQuaternary: tokens.fg3,
          colorBgContainer: tokens.card,
          colorBgElevated: tokens.card,
          colorBgLayout: tokens.canvas,
          colorFillQuaternary: tokens.sunken,
          colorFillTertiary: tokens.sunken,
          colorBorder: tokens.lineStrong,
          colorBorderSecondary: tokens.line,
          fontFamily: tokens.sans,
          fontSize: 13,
          borderRadius: 6,
          controlHeight: 30,
          controlHeightSM: 26,
          lineWidth: 1,
          wireframe: false,
        },
        components: {
          Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 500, paddingInline: 12 },
          Input: { paddingInline: 10 },
          Select: { optionSelectedBg: tokens.accentSoft },
          Segmented: { itemSelectedBg: tokens.card, trackBg: tokens.sunken },
          Tabs: { horizontalItemPadding: '8px 0', horizontalItemGutter: 20 },
          Tooltip: { fontSize: 12 },
          Drawer: { paddingLG: 16 },
          Tag: { defaultBg: tokens.sunken, defaultColor: tokens.fg2 },
        },
      }}
    >
      <AntApp component={false}>{children}</AntApp>
    </ConfigProvider>
  )
}
