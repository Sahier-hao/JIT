import { useState } from 'react'
import { Icon } from '../Icon'
import { Popover } from '../ui/popover'
import { IconButton } from '../ui/controls'
import { cn } from '../lib/utils'
import { THEMES, initialTheme, initialDensity, applyTheme, applyDensity, writeStored, THEME_KEY, DENSITY_KEY, type ThemeId } from '../preferences'

const optionClass = (selected: boolean) => cn(
  'rounded-sm border px-2 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  selected ? 'border-accent bg-accent-soft font-medium text-foreground' : 'border-border-soft text-foreground-2 hover:bg-hover',
)

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
    <div className="grid gap-3">
      <strong className="text-sm font-semibold text-foreground">外观偏好</strong>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="主题">
        {THEMES.map(item => <button
          key={item.id}
          type="button"
          aria-pressed={theme === item.id}
          data-theme-option={item.id}
          onClick={() => chooseTheme(item.id)}
          className={optionClass(theme === item.id)}
        >{item.name}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="阅读密度">
        <button type="button" aria-pressed={density === 'comfortable'} onClick={() => { setDensity('comfortable'); applyDensity('comfortable'); writeStored(DENSITY_KEY, 'comfortable') }} className={optionClass(density === 'comfortable')}>舒适</button>
        <button type="button" aria-pressed={density === 'compact'} onClick={() => { setDensity('compact'); applyDensity('compact'); writeStored(DENSITY_KEY, 'compact') }} className={optionClass(density === 'compact')}>紧凑</button>
      </div>
    </div>
  </Popover>
}
