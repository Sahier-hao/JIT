import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  deriveCuration, previewCuration,
  type UserCurationPreview, type UserDataset,
} from '@/features/account/userClient'

const EXCLUSION_LABELS: Record<string, string> = {
  duplicate: '重复提交',
  missing: '缺少字段',
  'max-value': '超过提交规模上限',
}

type CurationRule =
  | { id: 'drop-duplicates' }
  | { id: 'drop-missing'; fields: string[] }
  | { id: 'max-value'; field: string; value: number }

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

export function DatasetCurationDialog({ open, onOpenChange, dataset, onDerived, onLoginRequired }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dataset: UserDataset | null
  onDerived: (version: string) => void
  onLoginRequired: () => void
}) {
  const [dedupe, setDedupe] = useState(true)
  const [dropMissing, setDropMissing] = useState<string[]>([])
  const [missingOpen, setMissingOpen] = useState(false)
  const [fileLimitEnabled, setFileLimitEnabled] = useState(false)
  const [fileLimit, setFileLimit] = useState('100')
  const [lineLimitEnabled, setLineLimitEnabled] = useState(false)
  const [lineLimit, setLineLimit] = useState('10000')
  const [preview, setPreview] = useState<UserCurationPreview | null>(null)
  const [previewRecipe, setPreviewRecipe] = useState('')
  const [busy, setBusy] = useState<'preview' | 'derive' | ''>('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDedupe(true)
    setDropMissing([])
    setMissingOpen(false)
    setFileLimitEnabled(false)
    setFileLimit('100')
    setLineLimitEnabled(false)
    setLineLimit('10000')
    setPreview(null)
    setPreviewRecipe('')
    setError('')
  }, [open, dataset?.version])

  const rules: CurationRule[] = []
  if (dedupe) rules.push({ id: 'drop-duplicates' })
  if (dropMissing.length) rules.push({ id: 'drop-missing', fields: dropMissing })
  if (fileLimitEnabled && dataset?.featureFields.includes('nf')) {
    const value = Number(fileLimit)
    if (Number.isFinite(value) && value >= 0) rules.push({ id: 'max-value', field: 'nf', value })
  }
  if (lineLimitEnabled && dataset?.featureFields.includes('la')) {
    const value = Number(lineLimit)
    if (Number.isFinite(value) && value >= 0) rules.push({ id: 'max-value', field: 'la', value })
  }
  const recipe = { version: 1, rules }
  const recipeText = JSON.stringify(recipe)
  const stale = preview !== null && previewRecipe !== recipeText

  function toggleMissing(field: string) {
    setDropMissing(values => values.includes(field)
      ? values.filter(item => item !== field)
      : [...values, field])
  }

  async function runPreview() {
    if (!dataset || !rules.length || busy) return
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

  const excluded = preview?.stats.excluded ?? {}
  const excludedItems = Object.entries(excluded).flatMap(([key, value]) => {
    const count = typeof value === 'number' ? value : null
    return count && count > 0 ? [{ label: EXCLUSION_LABELS[key] ?? key, count }] : []
  })

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto" style={{ width: 'min(94vw, 680px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>清洗数据</DialogTitle></DialogHeader>
      {!dataset ? <p className="py-6 text-center text-xs text-foreground-3">选择一个数据版本后再清洗。</p> : <div className="grid gap-4">
        <div className="rounded-lg bg-sunken p-3">
          <strong className="block truncate text-sm text-foreground">{dataset.dataset}</strong>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-3">
            <span>{numberText(dataset.quality.includedRows)} 行</span>
            <span>{numberText(dataset.quality.positiveLabels)} 正例</span>
            <span className="font-mono text-[11px]">{dataset.version}</span>
          </div>
        </div>
        <section className="grid gap-3 rounded-lg border border-border-soft p-3">
          <h2 className="text-xs font-medium text-foreground-2">清洗规则</h2>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={dedupe} onCheckedChange={value => setDedupe(value === true)}/>
            <span><span className="block">删除重复提交</span><span className="mt-0.5 block text-xs text-foreground-3">同一提交只保留一次。</span></span>
          </label>
          <div className="grid gap-2">
            <span className="text-sm">删除缺失字段</span>
            <Popover open={missingOpen} onOpenChange={setMissingOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-9 w-full justify-between gap-2 text-sm font-normal hover:bg-sunken hover:text-foreground" disabled={!dataset.featureFields.length}>
                  <span className={dropMissing.length ? 'text-foreground' : 'text-foreground-3'}>{dropMissing.length ? `已选择 ${dropMissing.length} 个字段` : '选择字段'}</span>
                  <ChevronDown aria-hidden="true" className="text-foreground-4" size={15}/>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(92vw,380px)] p-1.5">
                <div className="max-h-64 overflow-auto">
                  {dataset.featureFields.map(field => <label key={field} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sunken">
                    <Checkbox checked={dropMissing.includes(field)} onCheckedChange={() => toggleMissing(field)}/>
                    <code className="font-mono text-[11px]">{field}</code>
                  </label>)}
                </div>
                <div className="mt-1.5 flex justify-end border-t border-border-soft pt-1.5">
                  <Button size="sm" type="button" onClick={() => setMissingOpen(false)}><Check aria-hidden="true" size={14}/>完成</Button>
                </div>
              </PopoverContent>
            </Popover>
            {dropMissing.length ? <div className="flex flex-wrap gap-1.5">{dropMissing.map(field => <span key={field} className="inline-flex items-center gap-1 rounded-md bg-soft px-2 py-1 font-mono text-[11px] text-foreground-2">
              {field}
              <button type="button" className="text-foreground-4 hover:text-rose" aria-label={`移除字段 ${field}`} onClick={() => toggleMissing(field)}><X aria-hidden="true" size={12}/></button>
            </span>)}</div> : null}
          </div>
          <div className="grid gap-2 border-t border-border-soft pt-3">
            <span className="text-sm">提交规模上限</span>
            {dataset.featureFields.includes('nf') ? <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-foreground-2"><Checkbox checked={fileLimitEnabled} onCheckedChange={value => setFileLimitEnabled(value === true)}/>文件数不超过</label>
              <Input aria-label="文件数上限" type="number" min="0" value={fileLimit} onChange={event => setFileLimit(event.target.value)} disabled={!fileLimitEnabled}/>
            </div> : null}
            {dataset.featureFields.includes('la') ? <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-foreground-2"><Checkbox checked={lineLimitEnabled} onCheckedChange={value => setLineLimitEnabled(value === true)}/>新增行数不超过</label>
              <Input aria-label="新增行数上限" type="number" min="0" value={lineLimit} onChange={event => setLineLimit(event.target.value)} disabled={!lineLimitEnabled}/>
            </div> : null}
            <p className="text-[11px] text-foreground-4">超过上限的提交会被排除，不会修改原始版本。</p>
          </div>
        </section>
        {preview ? <div className={cn('grid gap-3 rounded-lg border p-3', stale ? 'border-amber/30 bg-amber-soft' : 'border-teal/20 bg-teal-soft/50')}>
          <div className="flex items-center justify-between gap-2"><strong className="text-sm text-foreground">清洗预览</strong>{stale ? <span className="text-[11px] text-amber-deep">规则已变化，请重新预览</span> : <span className="text-[11px] text-teal-deep">可生成新版本</span>}</div>
          <div className="grid grid-cols-3 gap-2">
            <div><span className="block text-[11px] text-foreground-4">原始</span><strong className="mt-0.5 block text-sm tabular-nums">{numberText(preview.stats.rawRows)}</strong></div>
            <div><span className="block text-[11px] text-foreground-4">保留</span><strong className="mt-0.5 block text-sm tabular-nums">{numberText(preview.stats.includedRows)}</strong></div>
            <div><span className="block text-[11px] text-foreground-4">排除</span><strong className="mt-0.5 block text-sm tabular-nums">{numberText(preview.stats.excludedRows)}</strong></div>
          </div>
          <div className="text-xs text-foreground-3">清洗后正例 {numberText(preview.stats.positiveLabels)} 个。</div>
          {excludedItems.length ? <div className="flex flex-wrap gap-1.5">{excludedItems.map(item => <span key={item.label} className="rounded-md bg-card px-2 py-1 text-[11px] text-foreground-2">{item.label} {numberText(item.count)}</span>)}</div> : null}
        </div> : null}
        {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" variant="outline" onClick={() => void runPreview()} disabled={!dataset || !rules.length || Boolean(busy)}>{busy === 'preview' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}预览结果</Button>
        <Button type="button" onClick={() => void derive()} disabled={!dataset || !preview || stale || Boolean(busy)}>{busy === 'derive' ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}生成新版本</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
