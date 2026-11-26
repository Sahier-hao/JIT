import { useEffect, useState } from 'react'
import { zhCN } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const CALENDAR_CLASS_NAMES = {
  root: 'p-0',
  months: 'relative',
  month: 'space-y-2',
  month_caption: 'flex h-8 items-center justify-center px-8',
  caption_label: 'text-sm font-medium',
  nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
  button_previous: 'inline-flex size-8 items-center justify-center rounded-md text-foreground-3 hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  button_next: 'inline-flex size-8 items-center justify-center rounded-md text-foreground-3 hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-8 text-center text-xs font-normal text-foreground-4',
  week: 'flex w-full',
  day: 'relative size-8 p-0 text-center',
  day_button: 'size-8 rounded-md p-0 text-sm font-normal tabular-nums text-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
  selected: '[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground',
  today: '[&>button]:border [&>button]:border-accent [&>button]:text-accent',
  outside: 'invisible',
  disabled: '[&>button]:pointer-events-none [&>button]:text-foreground-4 [&>button]:opacity-40',
  hidden: 'invisible',
}

function parseIso(value: string): Date | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null
}

function formatIso(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function DatePicker({ value, onChange, ariaLabel, placeholder = '选择日期', min, max,
  disabled = false, clearable = true, invalid = false, className, size = 'default' }: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  min?: string
  max?: string
  disabled?: boolean
  clearable?: boolean
  invalid?: boolean
  className?: string
  size?: 'default' | 'sm'
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const selected = parseIso(value)
  const todayIso = formatIso(new Date())
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max)
  const draftDate = parseIso(draft)
  const draftIso = draftDate ? formatIso(draftDate) : null
  const canApply = Boolean(draftIso) && allowed(draftIso!)
  const minDate = min ? parseIso(min) : null
  const maxDate = max ? parseIso(max) : null

  function choose(iso: string) {
    if (!allowed(iso)) return
    onChange(iso)
    setOpen(false)
  }

  function applyDraft() {
    if (!canApply || draftIso === null) return
    onChange(draftIso)
    setOpen(false)
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size={size} aria-label={ariaLabel} aria-invalid={invalid || undefined}
        disabled={disabled} className={cn('w-full justify-start gap-2 font-normal', !value && 'text-foreground-3', className)}>
        <CalendarDays aria-hidden="true" size={15}/>
        <span className="truncate">{value || placeholder}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-auto p-0">
      <div className="grid gap-2 p-3">
        <DayPicker
          mode="single"
          selected={selected ?? undefined}
          defaultMonth={selected ?? undefined}
          onSelect={date => { if (date) choose(formatIso(date)) }}
          locale={zhCN}
          weekStartsOn={1}
          showOutsideDays={false}
          fixedWeeks
          autoFocus
          disabled={date => !allowed(formatIso(date))}
          startMonth={minDate ?? undefined}
          endMonth={maxDate ?? undefined}
          labels={{ labelPrevious: () => '上个月', labelNext: () => '下个月' }}
          classNames={CALENDAR_CLASS_NAMES}
          components={{
            Chevron: ({ orientation }) => orientation === 'left'
              ? <ChevronLeft aria-hidden="true" size={16}/>
              : <ChevronRight aria-hidden="true" size={16}/>,
          }}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-2">
          <Input aria-label={`${ariaLabel}手动输入`} value={draft} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyDraft() } }}
            placeholder="YYYY-MM-DD" className="h-8 w-32 text-xs" aria-invalid={Boolean(draft) && !draftDate || undefined}/>
          <Button type="button" size="sm" variant="ghost" onClick={applyDraft} disabled={!canApply}>应用日期</Button>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => choose(todayIso)} disabled={!allowed(todayIso)}>今天</Button>
            {clearable ? <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(''); setOpen(false) }} disabled={!value}>清除</Button> : null}
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
}
