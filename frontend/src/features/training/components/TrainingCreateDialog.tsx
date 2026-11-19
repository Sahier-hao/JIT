import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import {
  createUserExperiment, splitPreview, userDatasets,
  type UserDataset, type UserSplitPreview,
} from '@/features/account/userClient'
import { SPLIT_PRESETS } from '@/features/datasets/splitClient'
import { trainingMethods, type MethodChoice } from '@/features/models/modelClient'

const PARTITION_LABELS = { train: '训练', validation: '验证', test: '测试' } as const

function countText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

export function TrainingCreateDialog({ open, onOpenChange, initialDatasetVersion, onCreated, onLoginRequired }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDatasetVersion?: string
  onCreated: (experimentId: string) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [preset, setPreset] = useState('temporal-70-15-15')
  const [methods, setMethods] = useState<MethodChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [params, setParams] = useState<Record<string, Record<string, string>>>({})
  const [preview, setPreview] = useState<UserSplitPreview | null>(null)
  const [methodsOpen, setMethodsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError('')
    setChosen([])
    setParams({})
    setPreview(null)
    setMethods([])
    setMethodsOpen(false)
    userDatasets('usable', controller.signal).then(value => {
      if (controller.signal.aborted) return
      setDatasets(value)
      const preferred = value.find(item => item.version === initialDatasetVersion) ?? value[0]
      setSelected(preferred?.version ?? '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '数据读取失败')
    })
    return () => controller.abort()
  }, [open, initialDatasetVersion, onLoginRequired])

  const current = datasets?.find(item => item.version === selected) ?? null
  useEffect(() => {
    if (!open || !current) return
    const controller = new AbortController()
    setPreview(null)
    setMethods([])
    setChosen([])
    setParams({})
    trainingMethods(current.schema, controller.signal).then(value => {
      if (!controller.signal.aborted) setMethods(value.methods.filter(item => item.supportedSchema))
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '训练方法读取失败')
    })
    splitPreview(current.version, preset, controller.signal).then(value => {
      if (!controller.signal.aborted) setPreview(value)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '时间切分读取失败')
    })
    return () => controller.abort()
  }, [open, current?.version, current?.schema, preset])

  function toggle(method: string) {
    setChosen(values => values.includes(method) ? values.filter(item => item !== method) : [...values, method])
    const choice = methods.find(item => item.method === method)
    setParams(values => values[method] ? values : {
      ...values,
      [method]: Object.fromEntries((choice?.params ?? []).map(param => [param.name, param.default == null ? '' : String(param.default)])),
    })
  }

  async function submit() {
    if (!current || !chosen.length || busy) return
    setBusy(true)
    setError('')
    try {
      const payload = chosen.map(method => {
        const values: Record<string, number> = {}
        for (const spec of methods.find(item => item.method === method)?.params ?? []) {
          const raw = params[method]?.[spec.name]
          if (raw == null || raw.trim() === '') continue
          const numeric = Number(raw)
          if (!Number.isFinite(numeric)) throw new Error(`${method} 的参数 ${spec.name} 不是数值`)
          values[spec.name] = numeric
        }
        return { method, params: values }
      })
      const experiment = await createUserExperiment({ datasetVersion: current.version, methods: payload, splitPreset: preset })
      onCreated(experiment.experimentId)
      onOpenChange(false)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '实验创建失败')
    } finally {
      setBusy(false)
    }
  }

  const selectedMethods = chosen.flatMap(method => {
    const choice = methods.find(item => item.method === method)
    return choice ? [choice] : []
  })
  const partitionEntries = preview?.partitions
    ? (['train', 'validation', 'test'] as const).map(name => [name, preview.partitions![name]] as const)
    : []

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto" style={{ width: 'min(94vw, 680px)', maxWidth: 'none' }}>
      <DialogHeader><DialogTitle>开始训练</DialogTitle></DialogHeader>
      {datasets === null ? <p className="py-6 text-center text-xs text-foreground-3">正在读取可用数据…</p> : datasets.length === 0
        ? <div className="grid gap-2 rounded-lg border border-border-soft p-4"><p className="text-sm text-foreground-2">还没有可用于训练的数据。</p><p className="text-xs text-foreground-3">先到「我的数据」导入 CSV 或从公开仓库构建数据集。</p></div>
        : <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">数据版本</span>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger aria-label="训练数据版本"><SelectValue placeholder="选择数据"/></SelectTrigger>
              <SelectContent>{datasets.map(item => <SelectItem key={item.version} value={item.version}>{item.dataset} · {item.mine ? '我的数据' : '共享数据'} · {item.schema}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground-2">时间切分</span>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger aria-label="时间切分"><SelectValue/></SelectTrigger>
              <SelectContent>{SPLIT_PRESETS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          {current ? <div className="grid grid-cols-3 gap-2 rounded-lg bg-sunken p-3">
            <div><span className="block text-[11px] text-foreground-4">数据行数</span><strong className="mt-0.5 block text-sm tabular-nums text-foreground">{countText(current.quality.includedRows)}</strong></div>
            <div><span className="block text-[11px] text-foreground-4">正例</span><strong className="mt-0.5 block text-sm tabular-nums text-foreground">{countText(current.quality.positiveLabels)}</strong></div>
            <div><span className="block text-[11px] text-foreground-4">准入后</span><strong className="mt-0.5 block text-sm tabular-nums text-foreground">{preview ? countText(preview.eligibleRecords) : '检查中'}</strong></div>
          </div> : null}
          {partitionEntries.length ? <div className="grid gap-2 rounded-lg border border-border-soft p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground-2">切分预览</span>
              <span className={preview?.available ? 'text-teal-deep' : 'text-rose-deep'}>{preview?.available ? '可训练' : '不可训练'}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {partitionEntries.map(([name, part]) => <div key={name} className="rounded-md bg-sunken px-2 py-1.5">
                <span className="block text-[11px] text-foreground-4">{PARTITION_LABELS[name]}</span>
                <strong className="mt-0.5 block text-xs tabular-nums text-foreground">{countText(part.records)} 行 · {countText(part.positives)} 正例</strong>
              </div>)}
            </div>
          </div> : null}
          {preview && !preview.available ? <div className="rounded-lg border border-rose/20 bg-rose-soft p-3 text-xs text-rose-deep" role="alert">
            <strong className="block">为什么不能训练</strong>
            <p className="mt-1">{preview.reason?.message ?? '该数据不能进入训练'}</p>
            <p className="mt-1 text-rose-deep/80">可以更换切分比例，或补充更多正/负样本后重建数据。</p>
          </div> : null}
          <section className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-medium text-foreground-2">训练方法</h2>
              <span className="text-[11px] text-foreground-4">已选 {chosen.length}</span>
            </div>
            <Popover open={methodsOpen} onOpenChange={setMethodsOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-9 w-full justify-between gap-2 text-sm font-normal hover:bg-sunken hover:text-foreground" disabled={!methods.length} aria-label="选择训练方法">
                  <span className={chosen.length ? 'text-foreground' : 'text-foreground-3'}>{chosen.length ? `已选择 ${chosen.length} 个方法` : '选择训练方法'}</span>
                  <ChevronDown aria-hidden="true" className="text-foreground-4" size={15}/>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(92vw,420px)] p-1.5">
                <div className="max-h-72 overflow-auto">
                  {methods.map(choice => <label key={choice.method} className={cn('flex items-start gap-2 rounded-md px-2 py-2 text-sm', choice.available ? 'cursor-pointer hover:bg-sunken' : 'cursor-not-allowed opacity-50')}>
                    <Checkbox checked={chosen.includes(choice.method)} disabled={!choice.available} onCheckedChange={() => toggle(choice.method)}/>
                    <span className="min-w-0"><span className="block">{choice.name}</span>{choice.available ? null : <span className="mt-0.5 block text-[11px] text-foreground-3">{choice.reason ?? '当前不可用'}</span>}</span>
                  </label>)}
                </div>
                <div className="mt-1.5 flex justify-end border-t border-border-soft pt-1.5">
                  <Button size="sm" type="button" onClick={() => setMethodsOpen(false)}><Check aria-hidden="true" size={14}/>完成</Button>
                </div>
              </PopoverContent>
            </Popover>
            {selectedMethods.length ? <div className="flex flex-wrap gap-1.5">
              {selectedMethods.map(choice => <span key={choice.method} className="inline-flex items-center gap-1 rounded-md bg-soft px-2 py-1 text-xs text-foreground-2">
                {choice.name}
                <button type="button" className="text-foreground-4 hover:text-rose" aria-label={`移除 ${choice.name}`} onClick={() => toggle(choice.method)}><X aria-hidden="true" size={12}/></button>
              </span>)}
            </div> : <p className="text-xs text-foreground-3">选择一个或多个训练方法。</p>}
            {selectedMethods.filter(choice => choice.params.length).map(choice => <div key={choice.method} className="grid gap-2 rounded-lg border border-border-soft p-3">
              <strong className="text-xs font-medium text-foreground-2">{choice.name} 参数</strong>
              <div className="grid gap-2 sm:grid-cols-2">
                {choice.params.map(spec => <label key={spec.name} className="grid gap-1 text-xs text-foreground-3">{spec.name}（{spec.min}–{spec.max}）
                  <Input aria-label={`${choice.name} ${spec.name}`} min={spec.min} max={spec.max} step="any" value={params[choice.method]?.[spec.name] ?? ''} onChange={event => setParams(values => ({ ...values, [choice.method]: { ...(values[choice.method] ?? {}), [spec.name]: event.target.value } }))} type="number"/>
                </label>)}
              </div>
            </div>)}
          </section>
          {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
        </div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button type="button" disabled={!current || !chosen.length || !preview?.available || busy} onClick={() => void submit()}>{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}开始训练（{chosen.length} 个方法）</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
