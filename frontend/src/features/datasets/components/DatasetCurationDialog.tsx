import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, CopyX, LoaderCircle,
  Plus, Rows3, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  deriveCuration, previewCuration,
  type UserCurationPreview, type UserDataset,
} from '@/features/account/userClient'
import { CurationPreviewPanel } from '@/features/datasets/components/CurationPreviewPanel'
import { CURATION_RULE_LABELS, type CurationRule } from '@/features/datasets/curationContract'
import { numberText } from '@/features/datasets/mydata/format'

type CurationRuleInput = CurationRule & {
  id: 'drop-duplicates' | 'drop-missing' | 'keep-range' | 'quantile-range' | 'keep-date'
}

interface EditorStep {
  key: string
  rule: CurationRuleInput
}

type Operation = CurationRuleInput['id']

const OPERATIONS: { id: Operation; label: string; icon: typeof CopyX }[] = [
  { id: 'quantile-range', label: '保留分位区间', icon: SlidersHorizontal },
  { id: 'keep-range', label: '保留数值区间', icon: Rows3 },
  { id: 'keep-date', label: '保留日期范围', icon: CalendarDays },
  { id: 'drop-missing', label: '删除缺失字段', icon: CopyX },
  { id: 'drop-duplicates', label: '删除重复提交', icon: CopyX },
]

function fieldDefault(dataset: UserDataset | null): string {
  if (!dataset?.featureFields.length) return ''
  return dataset.featureFields.includes('la') ? 'la' : dataset.featureFields[0]
}

function initialSteps(dataset: UserDataset | null): EditorStep[] {
  const field = fieldDefault(dataset)
  return field ? [{
    key: `initial-${field}`,
    rule: { id: 'quantile-range', field, lower: 0.05, upper: 0.95 },
  }] : []
}

function nextRule(operation: Operation, dataset: UserDataset | null): CurationRuleInput {
  const field = fieldDefault(dataset)
  if (operation === 'drop-duplicates') return { id: operation }
  if (operation === 'drop-missing') return { id: operation, fields: field ? [field] : [] }
  if (operation === 'keep-date') {
    const start = typeof dataset?.timeRange.start === 'string' ? dataset.timeRange.start.slice(0, 10) : undefined
    const end = typeof dataset?.timeRange.end === 'string' ? dataset.timeRange.end.slice(0, 10) : undefined
    return { id: operation, start, end }
  }
  if (operation === 'quantile-range') return { id: operation, field, lower: 0.05, upper: 0.95 }
  return { id: operation, field, min: 0, max: 1000 }
}

function recipeRule(rule: CurationRuleInput): CurationRule {
  if (rule.id === 'drop-duplicates') return { id: rule.id }
  if (rule.id === 'drop-missing') return { id: rule.id, fields: rule.fields ?? [] }
  if (rule.id === 'keep-date') return {
    id: rule.id,
    ...(rule.start ? { start: rule.start } : {}),
    ...(rule.end ? { end: rule.end } : {}),
  }
  if (rule.id === 'quantile-range') return {
    id: rule.id, field: rule.field ?? '', lower: rule.lower ?? 0.05, upper: rule.upper ?? 0.95,
  }
  return {
    id: rule.id, field: rule.field ?? '',
    ...(rule.min == null ? {} : { min: rule.min }),
    ...(rule.max == null ? {} : { max: rule.max }),
  }
}

function validRule(rule: CurationRuleInput): boolean {
  if (rule.id === 'drop-duplicates') return true
  if (rule.id === 'drop-missing') return Boolean(rule.fields?.length)
  if (rule.id === 'keep-date') return Boolean(rule.start || rule.end)
  if (!rule.field) return false
  if (rule.id === 'quantile-range') {
    return rule.lower != null && rule.upper != null && rule.lower >= 0 && rule.lower < rule.upper && rule.upper <= 1
  }
  return rule.min != null || rule.max != null
}

function IconToolButton({ label, disabled, onClick, children }: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return <Tooltip><TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}

function MissingFieldsEditor({ dataset, fields, onChange }: {
  dataset: UserDataset
  fields: string[]
  onChange: (fields: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (field: string) => onChange(fields.includes(field)
    ? fields.filter(item => item !== field)
    : [...fields, field])
  return <div className="grid gap-2">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between gap-2 text-sm font-normal" disabled={!dataset.featureFields.length}>
          <span className={fields.length ? 'text-foreground' : 'text-foreground-3'}>{fields.length ? `已选择 ${fields.length} 个字段` : '选择字段'}</span>
          <ChevronDown aria-hidden="true" className="text-foreground-4" size={15}/>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(88vw,360px)] p-1.5">
        <div className="max-h-64 overflow-auto">
          {dataset.featureFields.map(field => <label key={field} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken">
            <Checkbox checked={fields.includes(field)} onCheckedChange={() => toggle(field)}/>
            <code className="font-mono text-[11px]">{field}</code>
          </label>)}
        </div>
        <div className="mt-1.5 flex justify-end border-t border-border-soft pt-1.5">
          <Button size="sm" type="button" onClick={() => setOpen(false)}><Check aria-hidden="true" size={14}/>完成</Button>
        </div>
      </PopoverContent>
    </Popover>
    {fields.length ? <div className="flex flex-wrap gap-1.5">{fields.map(field => <span key={field} className="inline-flex items-center gap-1 rounded-md bg-soft px-2 py-1 font-mono text-[11px] text-foreground-2">
      {field}
      <Button type="button" variant="ghost" size="icon-xs" className="text-foreground-4 hover:text-rose" aria-label={`移除字段 ${field}`} onClick={() => toggle(field)}><X aria-hidden="true" size={12}/></Button>
    </span>)}</div> : null}
  </div>
}

function StepEditor({ step, dataset, onChange }: {
  step: EditorStep
  dataset: UserDataset
  onChange: (rule: CurationRuleInput) => void
}) {
  const rule = step.rule
  if (rule.id === 'drop-duplicates') return <p className="text-xs text-foreground-3">按提交 ID 去重。</p>
  if (rule.id === 'drop-missing') return <MissingFieldsEditor dataset={dataset} fields={rule.fields ?? []} onChange={fields => onChange({ ...rule, fields })}/>
  if (rule.id === 'keep-date') return <div className="grid gap-2 sm:grid-cols-2">
    <div className="grid gap-1 text-[11px] text-foreground-3"><span>开始日期</span>
      <DatePicker ariaLabel="开始日期" placeholder="选择日期" size="sm" value={rule.start ?? ''} max={rule.end} onChange={value => onChange({ ...rule, start: value || undefined })}/>
    </div>
    <div className="grid gap-1 text-[11px] text-foreground-3"><span>结束日期</span>
      <DatePicker ariaLabel="结束日期" placeholder="选择日期" size="sm" value={rule.end ?? ''} min={rule.start} onChange={value => onChange({ ...rule, end: value || undefined })}/>
    </div>
  </div>
  if (rule.id === 'quantile-range') return <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px]">
    <label className="grid gap-1 text-[11px] text-foreground-3">特征
      <Select value={rule.field ?? ''} onValueChange={field => onChange({ ...rule, field })}>
        <SelectTrigger aria-label="分位区间特征"><SelectValue/></SelectTrigger>
        <SelectContent>{dataset.featureFields.map(field => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
      </Select>
    </label>
    <label className="grid gap-1 text-[11px] text-foreground-3">下分位 %
      <Input aria-label="下分位百分比" type="number" min={0} max={99} step={1}
        value={rule.lower == null ? '' : rule.lower * 100}
        onChange={event => onChange({ ...rule, lower: Number(event.target.value) / 100 })}/>
    </label>
    <label className="grid gap-1 text-[11px] text-foreground-3">上分位 %
      <Input aria-label="上分位百分比" type="number" min={1} max={100} step={1}
        value={rule.upper == null ? '' : rule.upper * 100}
        onChange={event => onChange({ ...rule, upper: Number(event.target.value) / 100 })}/>
    </label>
  </div>
  return <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_1fr_1fr]">
    <label className="grid gap-1 text-[11px] text-foreground-3">特征
      <Select value={rule.field ?? ''} onValueChange={field => onChange({ ...rule, field })}>
        <SelectTrigger aria-label="数值区间特征"><SelectValue/></SelectTrigger>
        <SelectContent>{dataset.featureFields.map(field => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
      </Select>
    </label>
    <label className="grid gap-1 text-[11px] text-foreground-3">最小值
      <Input aria-label="数值区间最小值" type="number" value={rule.min ?? ''}
        onChange={event => onChange({ ...rule, min: event.target.value === '' ? undefined : Number(event.target.value) })}/>
    </label>
    <label className="grid gap-1 text-[11px] text-foreground-3">最大值
      <Input aria-label="数值区间最大值" type="number" value={rule.max ?? ''}
        onChange={event => onChange({ ...rule, max: event.target.value === '' ? undefined : Number(event.target.value) })}/>
    </label>
  </div>
}

export function DatasetCurationDialog({ open, onOpenChange, dataset: seed, datasets, inline = false, onDerived, onLoginRequired }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataset?: UserDataset | null
  datasets?: UserDataset[]
  inline?: boolean
  onDerived: (version: string) => void
  onLoginRequired: () => void
}) {
  const options = useMemo(() => datasets ?? (seed ? [seed] : []), [datasets, seed])
  const [version, setVersion] = useState(seed?.version ?? options[0]?.version ?? '')
  const dataset = options.find(item => item.version === version) ?? options[0] ?? null
  const [steps, setSteps] = useState<EditorStep[]>(() => initialSteps(dataset))
  const [preview, setPreview] = useState<UserCurationPreview | null>(null)
  const [previewRecipe, setPreviewRecipe] = useState('')
  const [busy, setBusy] = useState<'preview' | 'derive' | ''>('')
  const [error, setError] = useState('')
  const sequence = useRef(0)

  useEffect(() => {
    setSteps(initialSteps(dataset))
    setPreview(null)
    setPreviewRecipe('')
    setError('')
  }, [dataset?.version])

  const ready = steps.length > 0 && steps.every(step => validRule(step.rule))
  const recipe = useMemo(() => ({
    version: 2,
    rules: steps.map(step => recipeRule(step.rule)),
  }), [steps])
  const recipeText = JSON.stringify(recipe)
  const stale = preview !== null && previewRecipe !== recipeText

  function addStep(operation: Operation) {
    sequence.current += 1
    const key = `${operation}-${sequence.current}`
    setSteps(items => [...items, { key, rule: nextRule(operation, dataset) }])
    setError('')
  }

  function updateStep(key: string, rule: CurationRuleInput) {
    setSteps(items => items.map(step => step.key === key ? { ...step, rule } : step))
    setError('')
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps(items => {
      const target = index + direction
      if (target < 0 || target >= items.length) return items
      const next = [...items]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function runPreview() {
    if (!dataset || !ready || busy) return
    setBusy('preview')
    setError('')
    try {
      const result = await previewCuration(dataset.version, recipe)
      setPreview(result)
      setPreviewRecipe(recipeText)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '清洗预览失败')
    } finally {
      setBusy('')
    }
  }

  async function derive() {
    if (!dataset || !preview || stale || busy) return
    setBusy('derive')
    setError('')
    try {
      const result = await deriveCuration(dataset.version, recipe)
      onDerived(result.version)
      onOpenChange(false)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '生成清洗版本失败')
    } finally {
      setBusy('')
    }
  }

  const body = <div className={inline ? 'grid gap-4' : 'min-h-0 overflow-y-auto px-4 py-4 sm:px-6'}>
      {!dataset ? <p className="py-6 text-center text-xs text-foreground-3">选择一个数据版本后再清洗。</p> : <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-sunken px-3 py-2.5">
          <div className="min-w-0">
            {options.length > 1 ? <Select value={version} onValueChange={setVersion}>
              <SelectTrigger aria-label="清洗数据版本" className="h-8 max-w-full text-sm"><SelectValue/></SelectTrigger>
              <SelectContent>{options.map(item => <SelectItem key={item.version} value={item.version}>{item.dataset} · {item.version}</SelectItem>)}</SelectContent>
            </Select> : <strong className="block truncate text-sm text-foreground">{dataset.dataset}</strong>}
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-3">
              <span>{numberText(dataset.quality.includedRows)} 行</span>
              <span>{numberText(dataset.quality.positiveLabels)} 正例</span>
              <span className="font-mono text-[10px]">{dataset.version}</span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)}><Plus aria-hidden="true"/>添加操作</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {OPERATIONS.map(operation => {
                const Icon = operation.icon
                const needsField = operation.id !== 'drop-duplicates' && operation.id !== 'keep-date'
                return <DropdownMenuItem key={operation.id} disabled={needsField && !dataset.featureFields.length}
                  onSelect={() => addStep(operation.id)}>
                  <Icon aria-hidden="true"/>{operation.label}
                </DropdownMenuItem>
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <section className="grid gap-2" aria-labelledby="curation-operations">
          <div className="flex items-center justify-between gap-2">
            <h2 id="curation-operations" className="text-xs font-medium text-foreground-2">操作序列</h2>
            <span className="text-[11px] text-foreground-4">{steps.length} 步</span>
          </div>
          {steps.length ? <div className="grid gap-2">{steps.map((step, index) => <article key={step.key} className="grid gap-3 rounded-lg border border-border-soft p-3">
            <header className="flex min-w-0 items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-soft text-[11px] tabular-nums text-foreground-2">{index + 1}</span>
              <strong className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{CURATION_RULE_LABELS[step.rule.id] ?? step.rule.id}</strong>
              <IconToolButton label="上移" disabled={index === 0 || Boolean(busy)} onClick={() => moveStep(index, -1)}><ArrowUp aria-hidden="true"/></IconToolButton>
              <IconToolButton label="下移" disabled={index === steps.length - 1 || Boolean(busy)} onClick={() => moveStep(index, 1)}><ArrowDown aria-hidden="true"/></IconToolButton>
              <IconToolButton label="删除操作" disabled={Boolean(busy)} onClick={() => setSteps(items => items.filter(item => item.key !== step.key))}><Trash2 aria-hidden="true"/></IconToolButton>
            </header>
            <StepEditor step={step} dataset={dataset} onChange={rule => updateStep(step.key, rule)}/>
          </article>)}</div> : <p className="border-t border-border-soft py-4 text-xs text-foreground-3">添加至少一个操作后预览。</p>}
        </section>

        {preview ? stale ? <div className="border-t border-amber/30 pt-3 text-xs text-amber-deep">操作已变化，请重新预览。</div>
          : <CurationPreviewPanel key={preview.recipeSha256} preview={preview}/> : null}
        {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      </div>}
  </div>
  const actions = <>
    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
    <Button type="button" variant="outline" onClick={() => void runPreview()} disabled={!dataset || !ready || Boolean(busy)}>{busy === 'preview' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}预览结果</Button>
    <Button type="button" onClick={() => void derive()} disabled={!dataset || !preview || stale || Boolean(busy)}>{busy === 'derive' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}生成新版本</Button>
  </>
  if (inline) return <div className="grid gap-4" role="region" aria-label="清洗与预处理">{body}
    <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft pt-3">{actions}</div>
  </div>
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[92dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0" style={{ width: 'min(96vw, 920px)', maxWidth: 'none' }}>
      <DialogHeader className="border-b border-border-soft px-5 py-4 pr-12 sm:px-6"><DialogTitle>清洗与预处理</DialogTitle></DialogHeader>
      {body}
      <DialogFooter className="border-t border-border-soft bg-background px-4 py-3 sm:px-6">{actions}</DialogFooter>
    </DialogContent>
  </Dialog>
}
