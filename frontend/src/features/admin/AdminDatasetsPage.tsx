import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { fetchAdminDatasets, formatDate, type AdminDatasetVersion } from '@/features/admin/adminContracts'
import { EmptyState } from '@/components/shared/Feedback'
import { CardListSkeleton } from '@/components/shared/Skeletons'


import type { Route } from '@/app/navigation'
import { AdminDatasetDetailPage } from '@/features/admin/AdminDatasetDetailPage'
import { AdminPageHeader, ErrorNotice } from '@/features/admin/AdminShared'

export function AdminDatasetsPage({ dataset, version, navigate, expired }: {
  dataset?: string
  version?: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [datasets, setDatasets] = useState<AdminDatasetVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [usageFilter, setUsageFilter] = useState<'all' | 'branch' | 'pr'>('all')

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminDatasets(controller.signal).then(versions => {
      if (controller.signal.aborted) return
      setDatasets(versions)
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
    <CardListSkeleton label="正在读取数据集版本" rows={6}/>
  </section>
  if (error && !datasets.length) return <EmptyState title="数据集不可用" description={error}><Button onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重试</Button></EmptyState>
  if (dataset) {
    const versions = datasets.filter(item => item.dataset === dataset)
    if (!versions.length) return <EmptyState title="数据集不存在" description={dataset}><Button onClick={() => navigate({ name: 'admin', view: 'datasets' })} variant="outline" type="button">返回数据集列表</Button></EmptyState>
    return <AdminDatasetDetailPage key={`${dataset}:${version ?? ''}`} dataset={dataset} versions={versions} initialVersion={version} navigate={navigate} expired={expired}/>
  }
  return <section className="grid gap-4">
    <AdminPageHeader title="数据集" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="flex flex-wrap items-end gap-2"><ToggleGroup type="single" value={String(usageFilter)} onValueChange={nextValue => { if (nextValue) (value => setUsageFilter(value as 'all' | 'branch' | 'pr'))(nextValue as typeof usageFilter); }} aria-label="数据集来源">{([
      { label: '全部', value: 'all' }, { label: '分支分析', value: 'branch' }, { label: 'PR 分析', value: 'pr' },
    ]).map(option => <ToggleGroupItem key={String(option.value)} value={String(option.value)} disabled={'disabled' in option && option.disabled === true}>{option.label}</ToggleGroupItem>) }</ToggleGroup></div>
    {!grouped.length ? <p className="text-xs text-foreground-3">尚无已登记数据集</p> : <div className="grid max-h-[70vh] content-start gap-2 overflow-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">{grouped.map(([name, versions]) => <article className="admin-dataset-card grid gap-2 rounded-md border border-border-soft bg-card p-card" key={name}>
      <div className="grid gap-0.5"><h2 className="text-sm font-semibold text-foreground">{name}</h2><p className="text-xs text-foreground-3">{versions.length} 个版本 · {versions.at(-1)?.schema}</p><p className="text-xs text-foreground-4">最新数据 {versions.at(-1)?.timeRange.start ? formatDate(versions.at(-1)?.timeRange.start) : '未提供'} · {versions.filter(item => item.usage === 'pr').length} 个 PR 版本 · {versions.filter(item => item.shared).length} 个已共享</p></div>
      <Button className="justify-self-start" onClick={() => navigate({ name: 'admin', view: 'datasets', resourceId: name, version: versions.at(-1)?.version })} variant="outline" type="button">查看详情</Button>
    </article>)}</div>}
  </section>
}
