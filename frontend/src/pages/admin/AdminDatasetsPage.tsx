import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../apiContract'
import { fetchAdminDatasets, fetchAdminModels, formatDate, type AdminDatasetVersion, type Row } from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'


import type { Route } from '../../navigation'
import { AdminDatasetDetailPage } from './AdminDatasetDetailPage'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

export function AdminDatasetsPage({ dataset, version, navigate, expired }: {
  dataset?: string
  version?: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [datasets, setDatasets] = useState<AdminDatasetVersion[]>([])
  const [methods, setMethods] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [usageFilter, setUsageFilter] = useState<'all' | 'branch' | 'pr'>('all')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([fetchAdminDatasets(controller.signal), fetchAdminModels(controller.signal)]).then(([versions, catalog]) => {
      if (controller.signal.aborted) return
      setDatasets(versions)
      setMethods(catalog.methods)
      setError('')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '数据集读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, expired])

  const grouped = useMemo(() => {
    const values = new Map<string, AdminDatasetVersion[]>()
    datasets.filter(item => usageFilter === 'all' || item.usage === usageFilter)
      .forEach(item => values.set(item.dataset, [...(values.get(item.dataset) ?? []), item]))
    return [...values.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [datasets, usageFilter])

  if (loading) return <section className="grid gap-4">
    <AdminPageHeader title="数据集" onRefresh={() => setRevision(value => value + 1)}/>
    <LoadingNotice label="正在读取数据集版本"/>
  </section>
  if (error && !datasets.length) return <EmptyState title="数据集不可用" description={error}><Button onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重试</Button></EmptyState>
  if (dataset) {
    const versions = datasets.filter(item => item.dataset === dataset)
    if (!versions.length) return <EmptyState title="数据集不存在" description={dataset}><Button onClick={() => navigate({ name: 'admin', view: 'datasets' })} variant="outline" type="button">返回数据集列表</Button></EmptyState>
    return <AdminDatasetDetailPage dataset={dataset} versions={versions} initialVersion={version} methods={methods} navigate={navigate} expired={expired}/>
  }
  return <section className="grid gap-4">
    <AdminPageHeader title="数据集" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="flex flex-wrap items-end gap-2"><ToggleGroup type="single" value={String(usageFilter)} onValueChange={nextValue => { if (nextValue) (value => setUsageFilter(value as 'all' | 'branch' | 'pr'))(nextValue as typeof usageFilter); }} aria-label="数据集来源">{([
      { label: '全部', value: 'all' }, { label: '分支分析', value: 'branch' }, { label: 'PR 分析', value: 'pr' },
    ]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup></div>
    {!grouped.length ? <p className="text-xs text-foreground-3">尚无已登记数据集</p> : <div className="grid max-h-[70vh] content-start gap-2 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">{grouped.map(([name, versions]) => <article className="admin-dataset-card grid gap-2 rounded-md border border-border-soft bg-card p-card" key={name}>
      <div className="grid gap-0.5"><h2 className="text-sm font-semibold text-foreground">{name}</h2><p className="text-xs text-foreground-3">{versions.length} 个版本 · {versions.at(-1)?.schema}</p><p className="text-xs text-foreground-4">最新数据 {versions.at(-1)?.timeRange.start ? formatDate(versions.at(-1)?.timeRange.start) : '未提供'} · {versions.filter(item => item.usage === 'pr').length} 个 PR 版本</p></div>
      <Button className="justify-self-start" onClick={() => navigate({ name: 'admin', view: 'datasets', resourceId: name, version: versions.at(-1)?.version })} variant="outline" type="button">查看详情</Button>
    </article>)}</div>}
  </section>
}
