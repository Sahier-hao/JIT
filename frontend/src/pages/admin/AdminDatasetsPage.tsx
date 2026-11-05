import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '../../apiContract'
import { fetchAdminDatasets, fetchAdminModels, formatDate, type AdminDatasetVersion, type Row } from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import { Segmented } from '../../ui/segmented'
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

  if (loading) return <section>
    <AdminPageHeader title="数据集" onRefresh={() => setRevision(value => value + 1)}/>
    <LoadingNotice label="正在读取数据集版本"/>
  </section>
  if (error && !datasets.length) return <EmptyState title="数据集不可用" description={error}><Button onClick={() => setRevision(value => value + 1)}>重试</Button></EmptyState>
  if (dataset) {
    const versions = datasets.filter(item => item.dataset === dataset)
    if (!versions.length) return <EmptyState title="数据集不存在" description={dataset}><Button onClick={() => navigate({ name: 'admin', view: 'datasets' })}>返回数据集列表</Button></EmptyState>
    return <AdminDatasetDetailPage dataset={dataset} versions={versions} initialVersion={version} methods={methods} navigate={navigate} expired={expired}/>
  }
  return <section>
    <AdminPageHeader title="数据集" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-dataset-filters"><Segmented aria-label="数据集来源" value={usageFilter} onChange={value => setUsageFilter(value as 'all' | 'branch' | 'pr')} options={[
      { label: '全部', value: 'all' }, { label: '分支分析', value: 'branch' }, { label: 'PR 分析', value: 'pr' },
    ]}/></div>
    {!grouped.length ? <p className="quiet-empty">尚无已登记数据集</p> : <div className="admin-dataset-list">{grouped.map(([name, versions]) => <article className="admin-dataset-card" key={name}>
      <div className="admin-dataset-main"><h2>{name}</h2><p>{versions.length} 个版本 · {versions.at(-1)?.schema}</p><p className="admin-card-meta">最新数据 {versions.at(-1)?.timeRange.start ? formatDate(versions.at(-1)?.timeRange.start) : '未提供'} · {versions.filter(item => item.usage === 'pr').length} 个 PR 版本</p></div>
      <Button onClick={() => navigate({ name: 'admin', view: 'datasets', resourceId: name, version: versions.at(-1)?.version })}>查看详情</Button>
    </article>)}</div>}
  </section>
}
