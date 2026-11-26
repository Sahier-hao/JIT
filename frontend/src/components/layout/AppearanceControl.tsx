import { Check, Palette, Rows2, Rows3 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  THEMES, initialTheme, initialDensity, applyTheme, applyDensity, writeStored,
  THEME_KEY, DENSITY_KEY, type ThemeId,
} from '@/lib/preferences'
import { cn } from '@/lib/utils'

function ThemePreview({ theme }: { theme: (typeof THEMES)[number] }) {
  const { preview } = theme
  return <span
    aria-hidden="true"
    className="block h-[58px] overflow-hidden rounded-sm border"
    style={{ backgroundColor: preview.workspace, borderColor: preview.line }}
  >
    <span className="flex h-full">
      <span
        className="w-[26px] shrink-0 border-r p-1.5"
        style={{ backgroundColor: preview.rail, borderColor: preview.line }}
      >
        <span className="block h-1.5 w-3.5 rounded-full" style={{ backgroundColor: preview.accent }}/>
        <span className="mt-2 grid gap-1">
          <span className="block h-1 w-4 rounded-full opacity-40" style={{ backgroundColor: preview.ink }}/>
          <span className="block h-1 w-3 rounded-full opacity-40" style={{ backgroundColor: preview.ink }}/>
          <span className="block h-1 w-[18px] rounded-full opacity-40" style={{ backgroundColor: preview.ink }}/>
        </span>
      </span>
      <span className="flex-1 p-1.5">
        <span
          className="block rounded-sm border p-1.5"
          style={{ backgroundColor: preview.card, borderColor: preview.line }}
        >
          <span className="flex items-center gap-1">
            <span className="block h-1.5 w-7 rounded-full opacity-80" style={{ backgroundColor: preview.ink }}/>
            <span className="ml-auto block h-2.5 w-5 rounded-sm" style={{ backgroundColor: preview.accent }}/>
          </span>
          <span className="mt-1.5 grid gap-1">
            <span className="block h-1 w-full rounded-full opacity-20" style={{ backgroundColor: preview.ink }}/>
            <span className="block h-1 w-2/3 rounded-full opacity-20" style={{ backgroundColor: preview.ink }}/>
          </span>
        </span>
      </span>
    </span>
  </span>
}

export function AppearanceControl() {
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeId>(initialTheme)
  const [density, setDensity] = useState(initialDensity)
  const selectedTheme = THEMES.find(item => item.id === theme) ?? THEMES[0]

  function chooseTheme(id: ThemeId) {
    setTheme(id)
    applyTheme(id)
    writeStored(THEME_KEY, id)
  }

  function chooseDensity(id: 'comfortable' | 'compact') {
    setDensity(id)
    applyDensity(id)
    writeStored(DENSITY_KEY, id)
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button aria-expanded={open} aria-label="外观偏好" title="外观偏好" variant="ghost" size="icon-sm" type="button">
        <Palette aria-hidden="true" focusable="false" strokeWidth={1.5} size={18}/>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} aria-label="外观偏好" className="w-[340px] max-w-[calc(100vw-24px)] overflow-hidden p-0">
      <div className="flex items-center gap-2.5 border-b border-border-soft px-4 py-3">
        <span className="grid size-7 place-items-center rounded-sm bg-sunken text-foreground-2">
          <Palette aria-hidden="true" size={15} strokeWidth={1.5}/>
        </span>
        <h2 className="text-sm font-semibold text-foreground">外观偏好</h2>
      </div>
      <div className="grid gap-4 p-4">
        <section className="grid gap-2" aria-labelledby="appearance-theme-label">
          <div className="flex items-center justify-between gap-2">
            <h3 id="appearance-theme-label" className="text-xs font-medium text-foreground-2">主题</h3>
            <span className="text-xs text-foreground-3" aria-live="polite">{selectedTheme.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="主题">
            {THEMES.map(item => {
              const selected = theme === item.id
              return <Button
                key={item.id}
                variant="ghost"
                type="button"
                aria-pressed={selected}
                data-theme-option={item.id}
                onClick={() => chooseTheme(item.id)}
                className={cn(
                  'h-auto w-full flex-col items-stretch gap-2 rounded-md border p-2 text-left',
                  selected
                    ? 'border-accent bg-accent-soft text-foreground'
                    : 'border-border-soft bg-card text-foreground-2 hover:border-border hover:bg-hover',
                )}
              >
                <ThemePreview theme={item}/>
                <span className="flex items-center justify-between gap-2 px-0.5">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <span className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full border',
                    selected ? 'border-accent bg-accent text-primary-foreground' : 'border-border-soft',
                  )}>
                    {selected ? <Check aria-hidden="true" size={10} strokeWidth={2.5}/> : null}
                  </span>
                </span>
              </Button>
            })}
          </div>
        </section>

        <section className="grid gap-2" aria-labelledby="appearance-density-label">
          <h3 id="appearance-density-label" className="text-xs font-medium text-foreground-2">内容密度</h3>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="阅读密度">
            {([
              { id: 'comfortable', label: '舒适', hint: '宽松行距', icon: Rows3 },
              { id: 'compact', label: '紧凑', hint: '更多信息', icon: Rows2 },
            ] as const).map(item => {
              const selected = density === item.id
              return <Button
                key={item.id}
                variant="ghost"
                type="button"
                aria-pressed={selected}
                onClick={() => chooseDensity(item.id)}
                className={cn(
                  'h-auto w-full justify-start gap-2 rounded-md border p-2 text-left',
                  selected
                    ? 'border-accent bg-accent-soft text-foreground'
                    : 'border-border-soft bg-card text-foreground-2 hover:border-border hover:bg-hover',
                )}
              >
                <span className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-sm',
                  selected ? 'bg-accent text-primary-foreground' : 'bg-sunken text-foreground-3',
                )}>
                  <item.icon aria-hidden="true" size={14} strokeWidth={1.5}/>
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <span className="text-xs text-foreground-3">{item.hint}</span>
                </span>
                {selected ? <Check aria-hidden="true" className="ml-auto text-accent" size={14} strokeWidth={2.5}/> : null}
              </Button>
            })}
          </div>
        </section>
      </div>
    </PopoverContent>
  </Popover>
}
