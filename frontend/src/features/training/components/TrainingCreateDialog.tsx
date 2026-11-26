import { Activity, BookOpenText, Check, ChevronDown, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, NetworkError } from '@/lib/apiContract'
import { cn } from '@/lib/utils'
import {
  createUserExperiment, splitPreview, userDatasets,
  type UserDataset, type UserSplitPreview,
} from '@/features/account/userClient'
import type { TrainingExperiment } from '@/features/admin/adminContracts'
import { SPLIT_PRESETS } from '@/features/datasets/splitClient'
import { trainingMethods, type MethodChoice } from '@/features/models/modelClient'
import { AlgorithmLibraryDialog } from '@/features/training/components/AlgorithmLibraryDialog'

const PARTITIONS = [
  { key: 'train', label: '训练', color: 'bg-accent' },
  { key: 'validation', label: '验证', color: 'bg-accent/60' },
  { key: 'test', label: '测试', color: 'bg-accent/30' },
] as const
const MAX_METHODS = 4

function SplitSummary({ preview }: { preview: UserSplitPreview }) {
  const partitions = preview.partitions

  return <div className="grid gap-2.5 border-t border-border-soft pt-3.5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-medium">切分预览</h3>
      <span className={cn('text-xs tabular-nums', preview.available ? 'text-accent' : 'text-rose-deep')}>
        {preview.available ? preview.eligibleRecords.toLocaleString('zh-CN') + ' 行可训练' : '不可训练'}
      </span>
    </div>
    {partitions ? <>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-soft" aria-hidden="true">
        {PARTITIONS.map(part => <div key={part.key} className={part.color} style={{ flexGrow: partitions[part.key].records }}/>)}
      </div>
      <table className="w-full table-fixed text-left text-xs tabular-nums">
        <thead className="text-foreground-3">
          <tr><th scope="col" className="pb-1 font-normal">分区</th><th scope="col" className="pb-1 text-right font-normal">行数</th><th scope="col" className="pb-1 text-right font-normal">正例</th></tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {PARTITIONS.map(part => <tr key={part.key}>
            <th scope="row" className="py-1.5 font-medium">{part.label}</th>
            <td className="text-right">{partitions[part.key].records.toLocaleString('zh-CN')}</td>
            <td className="text-right">{partitions[part.key].positives.toLocaleString('zh-CN')}</td>
          </tr>)}
        </tbody>
      </table>
    </> : null}
    {preview.available ? null : <p className="text-xs leading-body text-rose-deep" role="alert">
      {preview.reason?.message ?? '该数据不能进入训练'}
    </p>}
  </div>
}

export function TrainingCreateDialog({ open, onOpenChange, initialDatasetVersion, initialMethod, preferredSchema, onCreated, onLoginRequired, onOpenData }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialDatasetVersion?: string
  initialMethod?: string
  preferredSchema?: string
  onCreated: (experiment: TrainingExperiment) => void
  onLoginRequired: () => void
  onOpenData: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [preset, setPreset] = useState('temporal-70-15-15')
  const [methods, setMethods] = useState<MethodChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [params, setParams] = useState<Record<string, Record<string, string>>>({})
  const [preview, setPreview] = useState<UserSplitPreview | null>(null)
  const [initialNote, setInitialNote] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryMethod, setLibraryMethod] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submission = useRef<AbortController | null>(null)

  useEffect(() => () => submission.current?.abort(), [])

  function reportFailure(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
    else setError(failure instanceof Error ? failure.message : fallback)
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError('')
    setDatasets(null)
    setSelected('')
    setLibraryOpen(false)
    setLibraryMethod(undefined)
    userDatasets('usable', controller.signal).then(({ datasets: value }) => {
      if (controller.signal.aborted) return
      const preferred = value.find(item => item.version === initialDatasetVersion)
        ?? (preferredSchema ? value.find(item => item.schema === preferredSchema) : undefined)
        ?? value[0]
      setDatasets(value)
      setSelected(preferred?.version ?? '')
    }).catch(failure => {
      if (!controller.signal.aborted) reportFailure(failure, '数据读取失败')
    })
    return () => controller.abort()
  }, [open, initialDatasetVersion, preferredSchema, onLoginRequired])

  const current = datasets?.find(item => item.version === selected)
  const version = current?.version
  const schema = current?.schema

  useEffect(() => {
    setMethods([])
    setChosen([])
    setParams({})
    setInitialNote('')
    if (!open || !schema) return
    const controller = new AbortController()
    trainingMethods(schema, controller.signal).then(value => {
      if (controller.signal.aborted) return
      const usable = value.methods.filter(item => item.supportedSchema)
      setMethods(usable)
      const candidate = value.methods.find(item => item.method === initialMethod)
      if (candidate && candidate.supportedSchema && candidate.available) {
        setChosen([candidate.method])
        setParams(values => values[candidate.method] ? values : { ...values, [candidate.method]: paramsFor(candidate) })
      } else if (candidate) {
        setInitialNote(candidate.supportedSchema ? candidate.reason ?? '该方法当前不可用' : '该方法不支持当前数据的特征规范')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) reportFailure(failure, '训练方法读取失败')
    })
    return () => controller.abort()
  }, [open, schema, initialMethod, onLoginRequired])

  useEffect(() => {
    setPreview(null)
    if (!open || !version) return
    const controller = new AbortController()
    splitPreview(version, preset, controller.signal).then(value => {
      if (!controller.signal.aborted) setPreview(value)
    }).catch(failure => {
      if (!controller.signal.aborted) reportFailure(failure, '时间切分读取失败')
    })
    return () => controller.abort()
  }, [open, version, preset, onLoginRequired])

  const selectedMethods = chosen.flatMap(method => {
    const choice = methods.find(item => item.method === method)
    return choice ? [choice] : []
  })

  function paramsFor(choice: MethodChoice) {
    return Object.fromEntries(choice.params.map(param => [param.name, param.default == null ? '' : String(param.default)]))
  }

  function toggle(choice: MethodChoice) {
    setChosen(values => {
      if (values.includes(choice.method)) return values.filter(item => item !== choice.method)
      return values.length < MAX_METHODS && choice.available ? [...values, choice.method] : values
    })
    setParams(values => values[choice.method] ? values : {
      ...values,
      [choice.method]: paramsFor(choice),
    })
  }

  async function submit() {
    if (!current || !preview?.available || !selectedMethods.length || submission.current) return
    const controller = new AbortController()
    submission.current = controller
    setBusy(true)
    setError('')
    try {
      const payload = selectedMethods.map(choice => {
        const values: Record<string, number> = {}
        for (const spec of choice.params) {
          const raw = params[choice.method]?.[spec.name]
          if (raw == null || raw.trim() === '') continue
          const value = Number(raw)
          if (!Number.isFinite(value)) throw new Error(choice.name + '的' + spec.label + '需要填写数值')
          values[spec.name] = value
        }
        return { method: choice.method, params: values }
      })
      const experiment = await createUserExperiment({
        datasetVersion: current.version, methods: payload, splitPreset: preset,
      }, controller.signal)
      if (controller.signal.aborted) return
      onCreated(experiment)
      onOpenChange(false)
    } catch (failure) {
      if (controller.signal.aborted) return
      if (failure instanceof NetworkError && failure.timedOut) setError('等待确认超时。请先查看训练记录，确认任务状态。')
      else reportFailure(failure, '训练提交失败')
    } finally {
      submission.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => { if (!submission.current) onOpenChange(next) }}>
    <DialogContent aria-describedby={undefined} showCloseButton={!busy}
      className="max-h-[min(90dvh,48rem)] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[56rem]">
      <DialogHeader className="flex-row items-center gap-3 border-b border-border-soft px-5 py-4 text-left sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Activity size={19} aria-hidden="true"/></span>
        <DialogTitle>开始训练</DialogTitle>
      </DialogHeader>

      <div className="min-h-0 overflow-y-auto" aria-busy={busy}>
        {datasets === null ? <p className="px-5 py-8 text-sm text-foreground-3" role="status">{error ? '数据暂不可用' : '正在读取可用数据…'}</p>
          : datasets.length === 0 ? <p className="px-5 py-8 text-sm text-foreground-3">先导入或构建一个数据集，再开始训练。</p>
          : <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <section className="grid min-w-0 content-start gap-4 border-b border-border-soft bg-sunken/50 p-5 sm:px-6 md:border-r md:border-b-0" aria-label="数据与切分">
              <h2 className="text-sm font-semibold">数据与切分</h2>
              <div className="grid gap-1.5">
                <label htmlFor="training-data-version" className="text-xs font-medium text-foreground-2">数据版本</label>
                <Select value={selected} disabled={busy} onValueChange={value => { setPreview(null); setError(''); setSelected(value) }}>
                  <SelectTrigger id="training-data-version" aria-label="训练数据版本" className="bg-card">
                    <SelectValue placeholder="选择数据">{current?.dataset}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-w-[min(90vw,36rem)]">
                    {datasets.map(item => <SelectItem key={item.version} value={item.version}>
                      <span className="block min-w-0 [overflow-wrap:anywhere]">{item.dataset} · {item.version}</span>
                    </SelectItem>)}
                  </SelectContent>
                </Select>
                {current ? <div className="grid gap-1 text-xs text-foreground-3">
                  <p className="truncate font-mono" title={current.version}>{current.version}</p>
                  <p>{current.mine ? '我的数据' : '共享数据'} · {current.schema}</p>
                  {preferredSchema && current.schema !== preferredSchema ? <p className="text-amber-deep">当前数据不是 {preferredSchema}；请选择仓库口径数据，或先在我的数据中构建。</p> : null}
                </div> : null}
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="training-split" className="text-xs font-medium text-foreground-2">时间切分</label>
                <Select value={preset} disabled={busy} onValueChange={value => { setPreview(null); setError(''); setPreset(value) }}>
                  <SelectTrigger id="training-split" className="bg-card"><SelectValue/></SelectTrigger>
                  <SelectContent>{SPLIT_PRESETS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {preview ? <SplitSummary preview={preview}/> : current && !error ? <p role="status" className="text-xs text-foreground-3">正在检查时间切分…</p> : null}
            </section>

            <section className="grid min-w-0 content-start gap-3 p-5 sm:px-6" aria-label="训练方法">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">训练方法</h2>
                <div className="flex items-center gap-1">
                  <span className="text-xs tabular-nums text-foreground-3">{`已选 ${chosen.length} / ${MAX_METHODS}`}</span>
                  <Button type="button" size="xs" variant="ghost" disabled={!methods.length || busy}
                    onClick={() => { setLibraryMethod(undefined); setLibraryOpen(true) }}>
                    <BookOpenText aria-hidden="true" size={13}/>算法库
                  </Button>
                </div>
              </div>
              {methods.length ? <div role="group" aria-label="选择训练方法"
                className="grid max-h-[12rem] grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border-soft p-1 sm:grid-cols-2">
                {methods.map(choice => {
                  const checked = chosen.includes(choice.method)
                  const disabled = !choice.available || (!checked && chosen.length >= MAX_METHODS)
                  return <label key={choice.method} title={choice.available ? choice.name : choice.reason ?? '当前不可用'}
                    className={cn('flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5',
                      checked ? 'border-accent/40 bg-accent-soft' : 'border-transparent',
                      disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-sunken')}>
                    <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(choice)}/>
                    <span className="min-w-0 flex-1 truncate text-sm">{choice.name}</span>
                  </label>
                })}
              </div> : <p role="status" className="text-xs text-foreground-3">{schema ? '正在读取训练方法…' : '先选择数据版本'}</p>}
              {initialNote ? <p role="status" className="text-xs text-amber-deep">{initialNote}</p> : null}
              {selectedMethods.length ? <ul className="divide-y divide-border-soft rounded-lg border border-border-soft">
                {selectedMethods.map(choice => <li key={choice.method} className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true"/>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{choice.name}</span>
                    <Button type="button" size="xs" variant="ghost" disabled={busy}
                      onClick={() => { setLibraryMethod(choice.method); setLibraryOpen(true) }}>
                      <BookOpenText aria-hidden="true" size={13}/>算法说明
                    </Button>
                    <Button type="button" size="icon-xs" variant="ghost" disabled={busy} aria-label={'移除 ' + choice.name} onClick={() => toggle(choice)}>
                      <X aria-hidden="true"/>
                    </Button>
                  </div>
                  <p className="mt-0.5 pl-5.5 text-xs leading-5 text-foreground-3">{choice.guide.summary}</p>
                  {choice.params.length ? <details className="group mt-0.5 pl-5.5">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 py-1 text-xs font-medium text-foreground-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                      参数<ChevronDown className="size-3 group-open:rotate-180" aria-hidden="true"/>
                    </summary>
                    <p className="pb-2 pt-1 text-[11px] leading-4 text-foreground-3">
                      参数只改变模型如何拟合；不会改变数据切分、风险分数定义，也不会自动调参。
                    </p>
                    <div className="grid gap-x-3 gap-y-2.5 pb-1 pt-2 sm:grid-cols-2">
                      {choice.params.map(spec => {
                        const currentValue = params[choice.method]?.[spec.name] ?? ''
                        const defaultText = spec.default == null ? '' : String(spec.default)
                        const modified = spec.default == null
                          ? currentValue.trim() !== ''
                          : currentValue.trim() !== '' && Number(currentValue) !== spec.default
                        const inputId = `training-param-${choice.method}-${spec.name}`
                        const helpId = `${inputId}-help`
                        return <div key={spec.name} className="grid min-w-0 gap-1 text-xs text-foreground-2">
                          <label htmlFor={inputId} className="flex flex-wrap items-center gap-1.5 font-medium">
                            <span>{spec.label}</span>
                            <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-normal text-foreground-4">{spec.type === 'int' ? '整数' : '数值'}</span>
                            {modified ? <span className="rounded-sm bg-amber-soft px-1.5 py-0.5 text-[10px] font-normal text-amber-deep">已修改</span> : null}
                            <span className="select-none font-normal text-foreground-4">{spec.name}</span>
                          </label>
                          <Input id={inputId} aria-describedby={helpId}
                            aria-label={`${choice.name} ${spec.name}`}
                            min={spec.min} max={spec.max} step={spec.type === 'int' ? 1 : 'any'}
                            disabled={busy} value={currentValue} type="number"
                            onChange={event => {
                              const value = event.target.value
                              setParams(values => ({ ...values, [choice.method]: { ...values[choice.method], [spec.name]: value } }))
                            }}/>
                          <p id={helpId} className="leading-4 text-foreground-3">{spec.description}</p>
                          <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-foreground-4">
                            <span>默认 {defaultText || '—'}</span>
                            <span>范围 {spec.min}–{spec.max}</span>
                          </p>
                          <div className="flex flex-wrap gap-1">
                            <Button type="button" size="xs" variant="ghost" disabled={busy || !modified}
                              aria-label={`恢复 ${choice.name} ${spec.label} 默认值`}
                              onClick={() => setParams(values => ({
                                ...values,
                                [choice.method]: { ...values[choice.method], [spec.name]: defaultText },
                              }))}>
                              <RotateCcw aria-hidden="true" size={12}/>恢复默认
                            </Button>
                            <Button type="button" size="xs" variant="ghost" disabled={busy}
                              aria-label={`查看 ${choice.name} ${spec.label} 的算法库说明`}
                              onClick={() => { setLibraryMethod(choice.method); setLibraryOpen(true) }}>
                              <BookOpenText aria-hidden="true" size={12}/>算法库说明
                            </Button>
                          </div>
                        </div>
                      })}
                    </div>
                  </details> : null}
                </li>)}
              </ul> : null}
            </section>
          </div>}
      </div>

      <DialogFooter className="flex-col-reverse gap-3 border-t border-border-soft bg-card px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0 flex-1 text-xs">
          {error ? <p role="alert" className="leading-body text-rose-deep">{error}</p> : null}
          {busy ? <p role="status" className="text-foreground-3">正在等待队列确认</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>取消</Button>
          {datasets?.length === 0 ? <Button type="button" onClick={onOpenData}>打开我的数据</Button> : <Button type="button" disabled={!current || !selectedMethods.length || !preview?.available || busy} onClick={() => void submit()}>
            {busy ? <><LoaderCircle className="animate-spin" aria-hidden="true"/>正在提交训练…</>
              : selectedMethods.length ? '开始训练（' + selectedMethods.length + ' 个方法）' : '开始训练'}
          </Button>}
        </div>
      </DialogFooter>
    </DialogContent>
    <AlgorithmLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} methods={methods} schema={schema ?? '—'} initialMethod={libraryMethod}/>
  </Dialog>
}
