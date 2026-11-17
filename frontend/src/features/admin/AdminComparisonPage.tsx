import { Table, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { fetchAdminModel, fetchAdminModels, type AdminModel } from '@/features/admin/adminContracts'
import { EmptyState, LoadingNotice } from '@/components/shared/Feedback'

import type { Route } from '@/app/navigation'
import { AdminPageHeader, MetricComparison } from '@/features/admin/AdminShared'

export function AdminComparisonPage({ modelIds = [], navigate, expired }: {
  modelIds?: string[]
  navigate: (route: Route) => void
  expired: () => void
}) {
  const requestedFirst = modelIds[0] ?? ''
  const requestedSecond = modelIds[1] ?? ''
  const [models, setModels] = useState<AdminModel[]>([])
  const [first, setFirst] = useState(requestedFirst)
  const [second, setSecond] = useState(requestedSecond)
  const [result, setResult] = useState<{ first: string; second: string; left: AdminModel; right: AdminModel } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    fetchAdminModels(controller.signal).then(result => {
      if (controller.signal.aborted) return
      setModels(result.models)
      if (!requestedFirst && !requestedSecond) {
        const ready = result.models.filter(model => model.state === 'ready')
        setFirst(ready[0]?.modelId ?? '')
        setSecond(ready.find(model => model.modelId !== ready[0]?.modelId)?.modelId ?? '')
      }
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型列表读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [expired, requestedFirst, requestedSecond])
  useEffect(() => {
    if (!first || !second || first === second) return
    const controller = new AbortController()
    Promise.all([fetchAdminModel(first, controller.signal), fetchAdminModel(second, controller.signal)])
      .then(([a, b]) => { if (!controller.signal.aborted) { setResult({ first, second, left: a, right: b }); setError('') } })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '模型比较失败')
      })
    return () => controller.abort()
  }, [first, second, expired])
  if (loading) return <LoadingNotice label="正在读取可比模型"/>
  if (error && !models.length) return <EmptyState title="模型比较不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'models' })} variant="outline" type="button">返回模型列表</Button></EmptyState>
  const comparison = result?.first === first && result.second === second ? result : null
  const left = comparison?.left ?? null
  const right = comparison?.right ?? null
  const options = models.map(model => ({ value: model.modelId, label: `${model.name} · ${model.method}` }))
  return <section>
    <AdminPageHeader title="模型比较"/>
    <div className="flex flex-wrap items-end gap-3">
      <Select value={first == null ? '' : String(first)} onValueChange={nextValue => (setFirst)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="模型 A"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(options).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
      <Select value={second == null ? '' : String(second)} onValueChange={nextValue => (setSecond)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="模型 B"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(options).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select>
    </div>
    {first && !second ? <p className="text-xs text-foreground-3" role="status">请选择模型 B 进行比较。</p> : null}
    {error ? <p className="text-xs text-rose" role="alert">{error}</p> : null}
    {left && right ? <>
      {left.featureSchemaVersion !== right.featureSchemaVersion || left.artifactDatasetVersion !== right.artifactDatasetVersion ? <p className="rounded-sm border border-border-soft bg-sunken p-2.5 text-xs text-foreground-2" role="status">两个模型的数据版本或特征 schema 不同，指标只能并列，不能据此排名。</p> : null}
      <MetricComparison left={left.metrics ?? {}} right={right.metrics ?? {}} leftName={left.name} rightName={right.name}/>
      <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all"><TableBody>
        <TableRow><TableHead>方法</TableHead><TableCell>{left.method}</TableCell><TableCell>{right.method}</TableCell></TableRow>
        <TableRow><TableHead>schema</TableHead><TableCell>{left.featureSchemaVersion}</TableCell><TableCell>{right.featureSchemaVersion}</TableCell></TableRow>
        <TableRow><TableHead>数据版本</TableHead><TableCell>{left.artifactDatasetVersion}</TableCell><TableCell>{right.artifactDatasetVersion}</TableCell></TableRow>
        <TableRow><TableHead>运行</TableHead><TableCell><code>{left.runId}</code></TableCell><TableCell><code>{right.runId}</code></TableCell></TableRow>
        <TableRow><TableHead>状态</TableHead><TableCell>{left.state}</TableCell><TableCell>{right.state}</TableCell></TableRow>
      </TableBody></Table></div>
    </> : <p className="text-xs text-foreground-3">选择两个不同模型后并列比较。</p>}
  </section>
}
