import { useState } from 'react'
import { Icon } from '../Icon'
import { Popover } from '../ui/popover'
import { IconButton } from '../ui/controls'
import { THEMES, initialTheme, initialDensity, applyTheme, applyDensity, writeStored, THEME_KEY, DENSITY_KEY, type ThemeId } from '../preferences'

export function AppearanceControl() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(initialTheme)
  const [density, setDensity] = useState(initialDensity)
  function chooseTheme(id: ThemeId) {
    setTheme(id)
    applyTheme(id)
    writeStored(THEME_KEY, id)
  }
  return <Popover
    label="外观偏好"
    open={open}
    onOpenChange={setOpen}
    trigger={<IconButton label="外观偏好" aria-expanded={open} icon={<Icon name="sliders" size={18}/>}/>}
  >
    <div className="appearance-popover"><strong>外观偏好</strong>
      <div role="group" aria-label="主题">{THEMES.map(item => <button key={item.id} aria-pressed={theme === item.id} data-theme-option={item.id} onClick={() => chooseTheme(item.id)}>{item.name}</button>)}</div>
      <div role="group" aria-label="阅读密度"><button aria-pressed={density === 'comfortable'} onClick={() => { setDensity('comfortable'); applyDensity('comfortable'); writeStored(DENSITY_KEY, 'comfortable') }}>舒适</button><button aria-pressed={density === 'compact'} onClick={() => { setDensity('compact'); applyDensity('compact'); writeStored(DENSITY_KEY, 'compact') }}>紧凑</button></div>
    </div>
  </Popover>
}
