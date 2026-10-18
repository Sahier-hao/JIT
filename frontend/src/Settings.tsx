/**
 * 设置面板：承载外观偏好（主题、密度）。
 *
 * 行为（IP-05 / IP-07）：role="dialog" + aria-modal，Esc 关闭，遮罩点击关闭，
 * 打开时焦点进入面板、关闭后由 AppShell 把焦点还给触发元素。
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  DENSITY_KEY,
  THEMES,
  THEME_KEY,
  applyDensity,
  applyTheme,
  initialDensity,
  initialTheme,
  writeStored,
  type DensityId,
  type ThemeId,
} from './preferences'

export function Settings({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeId>(() => initialTheme())
  const [density, setDensity] = useState<DensityId>(() => initialDensity())
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function chooseTheme(id: ThemeId) {
    setTheme(id)
    applyTheme(id)
    writeStored(THEME_KEY, id)
  }

  function chooseDensity(id: DensityId) {
    setDensity(id)
    applyDensity(id)
    writeStored(DENSITY_KEY, id)
  }

  return (
    <>
      <div className="scrim" data-testid="settings-scrim" onClick={onClose} />
      <section
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
      >
        <header className="settings-head">
          <span id={titleId}>设置</span>
          <button className="icon-button" onClick={onClose} aria-label="关闭设置">
            <Icon name="close" />
          </button>
        </header>

        <div className="settings-body">
          <p className="settings-group">外观</p>

          <div className="theme-grid" role="group" aria-label="界面主题">
            {THEMES.map((item) => (
              <button
                key={item.id}
                className="theme-tile"
                aria-pressed={theme === item.id}
                onClick={() => chooseTheme(item.id)}
              >
                <span
                  className="theme-preview"
                  style={{ background: item.preview.bg, borderColor: item.preview.rail }}
                >
                  <span className="tp-rail" style={{ background: item.preview.rail }} />
                  <span className="tp-l1" style={{ background: item.preview.accent }} />
                  <span className="tp-l2" style={{ background: item.preview.rail }} />
                </span>
                <span className="theme-name">{item.name}</span>
              </button>
            ))}
          </div>

          <p className="settings-group">表格</p>
          <div className="density-choice" role="group" aria-label="表格密度">
            {([['comfortable', '舒适'], ['compact', '紧凑']] as [DensityId, string][]).map(([id, label]) => (
              <button key={id} aria-pressed={density === id} onClick={() => chooseDensity(id)}>
                {label}
              </button>
            ))}
          </div>

          <p className="settings-group">数据</p>
          <p className="settings-row"><span>时区</span><b>Asia/Shanghai</b></p>
          <p className="settings-row"><span>风险分档</span><b>暖色阶 · 5 档</b></p>
          <p className="settings-row"><span>字体</span><b>系统字族</b></p>
        </div>
      </section>
    </>
  )
}
