import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { LoaderCircle } from 'lucide-react'

import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { trainingMethods, type MethodChoice } from '@/features/models/modelClient'
import { SPLIT_PRESETS } from '@/features/datasets/splitClient'
import {
  createUserExperiment, deleteUserDataset, deriveCuration, exportDataset, previewCuration, splitPreview,
  userDatasets, useUserRevision, type UserDataset,
} from '@/features/account/userClient'


import { formatDate, valueLabel } from '@/features/admin/adminContracts'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'
import type { Route } from '@/app/navigation'

const RECIPE = '{\n  "version": 1,\n  "rules": [\n    { "id": "max-value", "field": "la", "value": 10000 }\n  ]\n}'

export function MyDataPage({ navigate, onLoginRequired }: {
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [datasets, setDatasets] = useState<UserDataset[] | null>(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [methods, setMethods] = useState<MethodChoice[]>([])
  const [chosen, setChosen] = useState<string[]>([])
  const [params, setParams] = useState<Record<string, Record<string, string>>>({})
  const [preset, setPreset] = useState('temporal-70-15-15')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const userRevision = useUserRevision()
  const [recipe, setRecipe] = useState(RECIPE)
  const [curation, setCuration] = useState<Record<string, unknown> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    userDatasets('usable', controller.signal).then(value => {
      if (!controller.signal.aborted) { setDatasets(value); setSelected(value[0]?.version ?? '') }
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '数据读取失败')
    })
    return () => controller.abort()
  }, [onLoginRequired, userRevision])

  const current = useMemo(() => datasets?.find(item => item.version === selected) ?? null, [datasets, selected])
  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    setMethods([]); setChosen([]); setParams({})
    trainingMethods(current.schema, controller.signal).then(value => {
      if (!controller.signal.aborted) setMethods(value.methods.filter(item => item.supportedSchema))
    }).catch(() => { /* 训练方法读取失败在表单提交时提示 */ })
    return () => controller.abort()
  }, [current?.schema, current?.version])
  useEffect(() => {
    if (!current) return
    const controller = new AbortController()
    setPreview(null)
    splitPreview(current.version, preset, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '切分预览失败') })
    return () => controller.abort()
  }, [current?.version, preset])

  function toggle(method: string) {
    setChosen(values => values.includes(method) ? values.filter(item => item !== method) : [...values, method])
    const choice = methods.find(item => item.method === method)
    setParams(values => values[method] ? values : { ...values, [method]: Object.fromEntries((choice?.params ?? []).map(param => [param.name, param.default == null ? '' : String(param.default)])) })
  }
  async function train() {
    if (!current) return
    setBusy(true); setError('')
    try {
      const methodsPayload = chosen.map(method => {
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
      if (!methodsPayload.length) throw new Error('至少选择一个训练方法')
      const experiment = await createUserExperiment({ datasetVersion: current.version, methods: methodsPayload, splitPreset: preset })
      navigate({ name: 'my-training', experimentId: experiment.experimentId })
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '实验创建失败')
    } finally { setBusy(false) }
  }
  async function runCuration(derive: boolean) {
    if (!current) return
    setBusy(true); setError('')
    try {
      const payload = JSON.parse(recipe)
      const result = derive ? await deriveCuration(current.version, payload) : await previewCuration(current.version, payload)
      setCuration(result)
      if (derive) {
        const version = ((result.dataset as Record<string, unknown> | undefined)?.version) as string | undefined
        if (version) setSelected(version)
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '清洗失败')
    } finally { setBusy(false) }
  }

  async function removeVersion() {
    if (!current) return
    setBusy(true); setError(''); setConfirmDelete(false)
    try {
      await deleteUserDataset(current.version)
      setDatasets(values => {
        const next = (values ?? []).filter(item => item.version !== current.version)
        setSelected(next[0]?.version ?? '')
        return next
      })
      setCuration(null); setPreview(null)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
      else setError(failure instanceof Error ? failure.message : '删除失败')
    } finally { setBusy(false) }
  }

  if (datasets === null) return <section className="grid gap-4">
    {error ? <div className="grid justify-items-start gap-2"><p className="text-xs text-rose" role="alert">{error}</p><Button onClick={onLoginRequired} variant="outline" type="button">登录后重试</Button></div>
      : <LoadingNotice label="正在读取我的数据"/>}
  </section>
  if (!datasets.length) return <section className="grid gap-4">
    <EmptyState title="还没有可用数据" description="在项目页点击「构建数据集」从真实提交采集，或使用管理员登记的共享数据集。">
      <Button variant='default' onClick={() => navigate({ name: 'repositories' })} type="button">去项目</Button>
    </EmptyState>
  </section>
  return <section className="grid gap-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">我的数据</h1><span className="text-xs text-foreground-3">{datasets.length} 个可用版本 · 每人最多保留 5 个自有版本</span></header>
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className="grid max-h-[70vh] content-start gap-2 overflow-auto pr-1" role="listbox" aria-label="我的数据版本">
        {datasets.map(item => <Button variant="ghost" key={item.version} role="option" aria-selected={item.version === selected}
          className={`grid gap-0.5 rounded-sm border p-2.5 text-left text-xs transition-colors ${item.version === selected ? 'border-accent bg-accent-soft' : 'border-border-soft bg-card hover:bg-hover'}`} onClick={() => setSelected(item.version)}>
          <strong className="truncate text-sm font-medium text-foreground">{item.dataset}</strong>
          <span className="text-foreground-3">{item.shared ? '共享数据' : '我的数据'} · {item.schema}</span>
          <span>{valueLabel(item.quality.includedRows)} 行 · {valueLabel(item.quality.positiveLabels)} 正例</span>
          <code className="break-all font-mono text-[11px] text-foreground-4">{item.version}</code>
        </Button>)}
      </div>
      <div className="grid gap-3">
        {current ? <>
          <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
            <div><dt>版本</dt><dd><code>{current.version}</code></dd></div>
            <div><dt>时间范围</dt><dd>{formatDate(current.timeRange.start)} — {formatDate(current.timeRange.end)}</dd></div>
            <div><dt>原始 / 纳入</dt><dd>{valueLabel(current.quality.rawRows)} / {valueLabel(current.quality.includedRows)}</dd></div>
            <div><dt>正例</dt><dd>{valueLabel(current.quality.positiveLabels)}</dd></div>
            <div><dt>CSV SHA-256</dt><dd><code>{valueLabel(current.file.sha256)}</code></dd></div>
            <div><dt>来源</dt><dd>{valueLabel(current.source.url)}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => exportDataset(current.version)} variant="outline" type="button">导出 CSV 包</Button>
            <Button onClick={() => setSelected(current.version)} variant="outline" type="button">刷新版本</Button>
            {current.mine ? <Button variant='destructive' onClick={() => setConfirmDelete(true)} disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}删除此版本</Button> : null}
          </div>
          <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">时间切分</h2>
            <div className="flex flex-wrap items-center gap-2"><Select value={preset == null ? '' : String(preset)} onValueChange={nextValue => (setPreset)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="时间切分预设"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{([...SPLIT_PRESETS]).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            {preview ? preview.available === false
              ? <p className="text-xs text-rose">{valueLabel((preview.reason as Record<string, unknown> | undefined)?.message ?? '该预设不可用')}</p>
              : <div className="grid gap-2 sm:grid-cols-3">{(['train', 'validation', 'test'] as const).map(name => {
                const part = (preview.partitions as Record<string, Record<string, unknown>> | undefined)?.[name]
                return <div key={name}><strong>{{ train: '训练', validation: '验证', test: '测试' }[name]}</strong><span>{valueLabel(part?.records)} 行 · {valueLabel(part?.positives)} 正例</span><span>{part?.start ? `${formatDate(part.start)} — ${formatDate(part.end)}` : '—'}</span></div>
              })}</div> : <p className="py-4 text-center text-xs text-foreground-3">正在计算切分…</p>}
          </section>
          <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">训练模型</h2>
            <div className="grid gap-2">
              {methods.map(choice => <div key={choice.method} className="grid gap-1.5 rounded-sm border border-border-soft p-2.5">
                <label className="inline-flex items-start gap-2 text-sm"><Checkbox checked={chosen.includes(choice.method)} disabled={!choice.available} onCheckedChange={() => toggle(choice.method)}/><span>{choice.name}{choice.available ? '' : `（${choice.reason ?? '不可用'}）`}</span></label>
                {chosen.includes(choice.method) && choice.params.length ? <div className="grid gap-2 pl-6 sm:grid-cols-2">
                  {choice.params.map(spec => <label key={spec.name} className="grid gap-1 text-xs text-foreground-3">{spec.name}（{spec.min}–{spec.max}）
                    <Input aria-label={`${choice.name} ${spec.name}`} min={spec.min} max={spec.max} step="any" value={params[choice.method]?.[spec.name] ?? ''} onChange={event => setParams(values => ({ ...values, [choice.method]: { ...(values[choice.method] ?? {}), [spec.name]: event.target.value } }))} type="number"/>
                  </label>)}
                </div> : null}
              </div>)}
            </div>
            <Button variant='default' disabled={Boolean(!chosen.length || !preview || preview.available !== true) || Boolean(busy)} onClick={() => void train()} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}开始训练（{chosen.length} 个方法）
            </Button>
          </section>
          {current.mine ? <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card"><h2 className="text-base font-semibold text-foreground">清洗与派生</h2>
            <Textarea aria-label="清洗配方" value={recipe} onChange={event => setRecipe(event.target.value)}/>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void runCuration(false)} variant="outline" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}预览清洗</Button>
              <Button onClick={() => void runCuration(true)} variant="outline" disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}生成派生版本</Button>
            </div>
            {curation ? <pre className="max-h-64 overflow-auto rounded-sm bg-dark p-2 font-mono text-[11px] text-on-dark">{JSON.stringify(curation, null, 2)}</pre> : null}
          </section> : null}
        </> : null}
      </div>
    </div>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}><AlertDialogContent className="max-h-[90vh] overflow-auto" style={{width: `min(92vw, ${460}px)`, maxWidth: 'none'}}><AlertDialogHeader><AlertDialogTitle>{"删除这个数据版本？"}</AlertDialogTitle><AlertDialogDescription>{"会删除该版本的登记、提交特征和文件，无法恢复；被模型或分析引用的版本会被拒绝。"}</AlertDialogDescription></AlertDialogHeader>{null}<AlertDialogFooter>{<><Button onClick={() => setConfirmDelete(false)} variant="outline" type="button">取消</Button><Button variant='destructive' onClick={() => void removeVersion()} disabled={Boolean(busy)} type="button">{busy ? <LoaderCircle className="animate-spin" aria-hidden="true"/> : undefined}确认删除</Button></>}</AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}
