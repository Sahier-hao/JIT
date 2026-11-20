import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ApiError } from '@/lib/apiContract'
import type { Route } from '@/app/navigation'
import { createTrainingExperiment, createTrainingTask, formatDate, type AdminDatasetVersion, type Row } from '@/features/admin/adminContracts'
import { ErrorNotice } from '@/features/admin/AdminShared'
import { previewDatasetSplit, SPLIT_PRESETS, type SplitPreview } from '@/features/datasets/splitClient'
import { trainingMethods, type MethodChoice } from '@/features/models/modelClient'

const PARTITIONS = [
  ['train', '训练'], ['validation', '验证'], ['test', '测试'],
] as const

export function AdminDatasetTrainingDialog({ selected, onClose, navigate, expired }: {
  selected: AdminDatasetVersion
  onClose: () => void
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [mode, setMode] = useState('single')
  const [methods, setMethods] = useState<MethodChoice[] | null>(null)
  const [method, setMethod] = useState('')
  const [selectedMethods, setSelectedMethods] = useState<string[]>([])
  const [paramValues, setParamValues] = useState<Record<string, Record<string, string>>>({})
  const [metricSet, setMetricSet] = useState('metric-set-v2')
  const [classPolicy, setClassPolicy] = useState<'none' | 'weights' | 'sample'>('none')
  const [splitPreset, setSplitPreset] = useState('temporal-70-15-15')
  const [maturityPolicy, setMaturityPolicy] = useState<'mature-only' | 'include-immature'>('mature-only')
  const [preview, setPreview] = useState<SplitPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [methodsError, setMethodsError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setMethodsError('')
    trainingMethods(selected.schema, controller.signal).then(value => {
      if (controller.signal.aborted) return
      const supported = value.methods.filter(item => item.supportedSchema)
      setMethods(supported)
      setMethod(current => supported.some(item => item.method === current && item.available)
        ? current : supported.find(item => item.available)?.method ?? '')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setMethodsError(failure instanceof Error ? failure.message : '读取训练方法失败')
    })
    return () => controller.abort()
  }, [selected.schema, revision, expired])

  useEffect(() => {
    const controller = new AbortController()
    setPreview(null)
    setPreviewError('')
    previewDatasetSplit(selected.version, splitPreset, controller.signal, maturityPolicy).then(value => {
      if (!controller.signal.aborted) setPreview(value)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setPreviewError(failure instanceof Error ? failure.message : '切分预览失败')
    })
    return () => controller.abort()
  }, [selected.version, splitPreset, maturityPolicy, revision, expired])

  function toggleMethod(choice: MethodChoice, checked: boolean) {
    setSelectedMethods(current => checked ? [...current, choice.method] : current.filter(item => item !== choice.method))
    if (checked) setParamValues(values => values[choice.method] ? values : {
      ...values,
      [choice.method]: Object.fromEntries(choice.params.map(param => [param.name, param.default == null ? '' : String(param.default)])),
    })
  }

  const selectedMethod = methods?.find(item => item.method === method)
  const chosenMethods = methods?.filter(item => item.available && selectedMethods.includes(item.method)) ?? []
  const ready = !methodsError && preview?.available && (mode === 'single' ? selectedMethod?.available : chosenMethods.length > 0)

  async function submit() {
    if (!ready || locked.current) return
    locked.current = true
    setBusy(true)
    setSubmitError('')
    const dataPolicy = classPolicy === 'none' ? undefined : { kind: classPolicy, seed: 0 }
    try {
      if (mode === 'single') {
        const task = await createTrainingTask(selected.version, method, metricSet, dataPolicy, splitPreset, maturityPolicy)
        navigate({ name: 'admin', view: 'training', resourceId: task.taskId })
      } else {
        const selections = chosenMethods.map(choice => {
          const params: Row = {}
          for (const spec of choice.params) {
            const raw = paramValues[choice.method]?.[spec.name]
            if (!raw?.trim()) continue
            const value = Number(raw)
            if (!Number.isFinite(value) || (spec.type === 'int' && !Number.isInteger(value))) {
              throw new Error(`${choice.name} 的参数 ${spec.name} 需填写有效${spec.type === 'int' ? '整数' : '数值'}`)
            }
            params[spec.name] = value
          }
          return { method: choice.method, params }
        })
        const experiment = await createTrainingExperiment({
          datasetVersion: selected.version, methods: selections, metricSet, classPolicy: dataPolicy, splitPreset, maturityPolicy,
        })
        navigate({ name: 'admin', view: 'training-experiment', resourceId: experiment.experimentId })
      }
      onClose()
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setSubmitError(failure instanceof Error ? failure.message : '创建训练失败')
    } finally { locked.current = false; setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !locked.current) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-[700px]">
      <DialogHeader className="min-w-0 pr-6">
        <DialogTitle>用于训练</DialogTitle>
        <DialogDescription className="break-words [overflow-wrap:anywhere]">{selected.version}</DialogDescription>
      </DialogHeader>
      <ToggleGroup aria-label="训练方式" type="single" value={mode} disabled={busy}
        onValueChange={value => { if (value) { setMode(value); setSubmitError('') } }} className="justify-self-start">
        <ToggleGroupItem value="single" size="sm">单方法</ToggleGroupItem>
        <ToggleGroupItem value="multi" size="sm">多方法实验</ToggleGroupItem>
      </ToggleGroup>
      <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2 [&_label]:grid [&_label]:gap-1 [&_label]:text-xs [&_label]:text-foreground-3">
        <label>时间切分预设
          <NativeSelect aria-label="时间切分预设" value={splitPreset} onChange={event => { setPreview(null); setSplitPreset(event.target.value) }}>
            {SPLIT_PRESETS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </NativeSelect>
        </label>
        <label>标签成熟策略
          <NativeSelect aria-label="标签成熟策略" value={maturityPolicy}
            onChange={event => { setPreview(null); setMaturityPolicy(event.target.value as typeof maturityPolicy) }}>
            <option value="mature-only">正式：排除未成熟标签</option>
            <option value="include-immature">敏感性：包含未成熟标签</option>
          </NativeSelect>
        </label>
        <label>指标集
          <NativeSelect aria-label="指标集" value={metricSet} onChange={event => setMetricSet(event.target.value)}>
            <option value="metric-set-v2">metric-set-v2</option><option value="metric-set-v1">metric-set-v1</option>
          </NativeSelect>
        </label>
        <label>训练分区类别策略
          <NativeSelect aria-label="训练分区类别策略" value={classPolicy} onChange={event => setClassPolicy(event.target.value as typeof classPolicy)}>
            <option value="none">不处理类别</option><option value="weights">训练分区加权</option><option value="sample">训练分区采样</option>
          </NativeSelect>
        </label>
      </fieldset>
      <section className="grid gap-2 rounded-lg border border-border-soft bg-card p-3" aria-label="切分预览">
        <h3 className="text-sm font-semibold">切分预览</h3>
        <ErrorNotice>{previewError}</ErrorNotice>
        {previewError ? <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setRevision(value => value + 1)}>重试预览</Button>
          : !preview ? <p role="status" className="text-xs text-foreground-3">正在读取切分预览…</p>
          : !preview.available ? <p role="alert" className="text-xs text-rose-deep">{preview.reason?.message ?? '该预设不可用'}</p>
          : <>
            <p className="text-xs text-foreground-3">样本 {preview.datasetRecords} · 合格 {preview.eligibleRecords ?? '未提供'} · {preview.timezone}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {PARTITIONS.map(([key, name]) => {
                const part = preview.partitions?.[key]
                return <div key={key} className="min-w-0 rounded-md bg-sunken px-2.5 py-2 text-xs">
                  <strong>{name}</strong>
                  <p className="mt-1">{part?.records ?? '—'} 条 · {part?.positives ?? '—'} 正例</p>
                  {part?.start && part.end ? <p className="mt-1 text-foreground-3">{formatDate(part.start)} 至 {formatDate(part.end)}</p> : null}
                </div>
              })}
            </div>
          </>}
      </section>
      {methodsError ? <div className="grid justify-items-start gap-2"><ErrorNotice>{methodsError}</ErrorNotice>
        <Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重试读取训练方法</Button>
      </div> : methods === null ? <p className="text-xs text-foreground-3" role="status">正在读取训练方法…</p>
        : !methods.length ? <p className="text-xs text-foreground-3">这个版本没有可选的训练方法。</p>
        : mode === 'single' ? <label className="grid gap-1.5 text-xs text-foreground-3">训练方法
          <NativeSelect aria-label="训练方法" value={method} disabled={busy} onChange={event => setMethod(event.target.value)}>
            {!method ? <option value="">请选择</option> : null}
            {methods.map(choice => <option key={choice.method} value={choice.method} disabled={!choice.available}>{choice.label || choice.name}{choice.reason ? ` · ${choice.reason}` : ''}</option>)}
          </NativeSelect>
        </label> : <div className="grid gap-2">
          {methods.map(choice => {
            const checked = selectedMethods.includes(choice.method)
            return <div key={choice.method} className="grid gap-2 rounded-lg border border-border-soft p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={checked} disabled={!choice.available || !preview?.available || busy}
                  onCheckedChange={value => toggleMethod(choice, value === true)}/>
                <span>{choice.name}{choice.reason ? ` · ${choice.reason}` : ''}</span>
              </label>
              {checked && choice.params.length ? <div className="grid gap-2 sm:grid-cols-2">
                {choice.params.map(spec => <label key={spec.name} className="grid gap-1 text-xs text-foreground-3">
                  {spec.name}（{spec.min}–{spec.max}）
                  <Input aria-label={`${choice.name} ${spec.name}`} type="number" min={spec.min} max={spec.max} step="any" disabled={busy}
                    value={paramValues[choice.method]?.[spec.name] ?? ''} onChange={event => {
                      const value = event.target.value
                      setParamValues(previous => ({ ...previous, [choice.method]: { ...previous[choice.method], [spec.name]: value } }))
                    }}/>
                </label>)}
              </div> : null}
            </div>
          })}
        </div>}
      <ErrorNotice>{submitError}</ErrorNotice>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="button" disabled={!ready || busy} onClick={() => void submit()}>
          {busy ? '正在创建…' : mode === 'single' ? '创建训练任务' : `创建实验（${chosenMethods.length} 个方法）`}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
}
