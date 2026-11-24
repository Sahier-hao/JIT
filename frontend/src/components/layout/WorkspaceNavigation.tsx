import { useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function WorkspaceNavigation({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return <div className="min-w-0 lg:hidden">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-full justify-start gap-1.5 px-1.5" aria-label="打开工作区导航">
          <Menu aria-hidden="true"/><span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} aria-label="工作区导航"
        className="max-h-(--radix-popover-content-available-height) w-[min(16rem,calc(100vw-1.5rem))] overflow-auto overscroll-contain p-2 lg:hidden"
        onClick={event => {
          if (event.target instanceof Element && event.target.closest('a,button')) setOpen(false)
        }}>
        {children}
      </PopoverContent>
    </Popover>
  </div>
}
