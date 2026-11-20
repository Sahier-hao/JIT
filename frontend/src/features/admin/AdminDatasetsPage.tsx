import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { linkTo, type Route } from '@/app/navigation'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { EmptyState } from '@/components/shared/Feedback'
import { MasterDetailSkeleton } from '@/components/shared/Skeletons'
import { ApiError } from '@/lib/apiContract'
import { fetchAdminDatasets, type AdminDatasetVersion } from '@/features/admin/adminContracts'
import { AdminCatalogLayout, CatalogSearch, catalogRowClass } from '@/features/admin/AdminCatalogLayout'
import { AdminDatasetDetailPage } from '@/features/admin/AdminDatasetDetailPage'
import { AdminDatasetCleanupDialog } from '@/features/admin/AdminDatasetTools'
import { AdminPageHeader, ErrorNotice } from '@/features/admin/AdminShared'

const SOURCES = [
  { value: 'all', label: '全部' },
  { value: 'branch', label: '分支采集' },
  { value: 'pr', label: 'PR 采集' },
  { value: 'import', label: 'CSV 导入' },
] as const

function groupVersions(versions: AdminDatasetVersion[]) {
  const groups = new Map<string, AdminDatasetVersion[]>()
  for (const item of versions) {
    const group = groups.get(item.dataset)
    if (group) group.push(item)
    else groups.set(item.dataset, [item])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => String(b.timeRange.end ?? '').localeCompare(String(a.timeRange.end ?? ''))
      || b.version.localeCompare(a.version))
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)))
}

export function AdminDatasetsPage({ dataset, version, navigate, expired }: {
  dataset?: string
  version?: string
  navigate: (route: Route, replace?: boolean) => void
  expired: () => void
}) {
  const [catalog, setCatalog] = useState<AdminDatasetVersion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)
  const jumpOnSelect = useRef(false)
  const refresh = () => {
    setLoading(true)
    setRevision(value => value + 1)
  }

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchAdminDatasets(controller.signal).then(versions => {
      if (!controller.signal.aborted) setCatalog(versions)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '数据集读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, expired])

  const groups = useMemo(() => groupVersions(catalog ?? []), [catalog])
  const term = query.trim().toLowerCase()
  const matches = [...groups].flatMap(([name, items]) => {
    const visible = items.filter(item => (sourceFilter === 'all' || item.usage === sourceFilter)
      && (!term || `${item.dataset} ${item.version} ${item.schema} ${item.source.url ?? ''}`.toLowerCase().includes(term)))
    if (!visible.length) return []
    const target = visible.find(item => item.version.toLowerCase() === term) ?? visible[0]
    return [{ name, versions: visible, target }]
  })
  const activeName = dataset ?? matches[0]?.name
  const options = activeName ? groups.get(activeName) ?? [] : []
  const selected = version ? options.find(item => item.version === version)
    : matches.find(group => group.name === activeName)?.target ?? options[0]

  useEffect(() => {
    const panel = detailRef.current
    if (!panel) return
    panel.scrollTop = 0
    if (jumpOnSelect.current && window.matchMedia?.('(max-width: 1023px)').matches) panel.scrollIntoView?.({ block: 'start' })
    jumpOnSelect.current = false
  }, [selected?.version])

  function selectVersion(item: AdminDatasetVersion) {
    navigate({ name: 'admin', view: 'datasets', resourceId: item.dataset, version: item.version })
  }

  function shareVersion(id: string, shared: boolean) {
    setCatalog(previous => previous?.map(item => item.version === id ? { ...item, shared } : item) ?? null)
  }

  return <section className="flex min-w-0 flex-col gap-4 lg:h-[calc(100dvh-10rem)] lg:min-h-[28rem]">
    <AdminPageHeader title="数据集" meta={catalog ? `${groups.size} 个数据集 · ${catalog.length} 个版本` : undefined}
      onRefresh={refresh}
      actions={<Button type="button" variant="outline" size="sm" onClick={() => setCleanupOpen(true)}>清理 PR 版本</Button>}/>
    <ErrorNotice>{error}</ErrorNotice>
    {catalog === null ? loading ? <MasterDetailSkeleton label="正在读取数据集版本"/>
      : <EmptyState title="数据集暂不可用"><Button type="button" variant="outline" onClick={refresh}>重新读取</Button></EmptyState>
      : <AdminCatalogLayout directoryLabel="数据集目录" listLabel="数据集列表" detailLabel="数据集详情" detailRef={detailRef}
        filters={<>
          <CatalogSearch label="搜索数据集" placeholder="搜索名称、版本或仓库" value={query} onChange={setQuery}/>
          <ToggleGroup type="single" value={sourceFilter} onValueChange={value => {
            if (!value) return
            setSourceFilter(value)
            if (dataset && value !== 'all' && selected?.usage !== value) navigate({ name: 'admin', view: 'datasets' }, true)
          }} aria-label="数据集来源" className="flex w-full flex-wrap justify-start gap-1">
            {SOURCES.map(source => <ToggleGroupItem key={source.value} value={source.value} size="sm" className="h-7 px-2 text-[11px]">{source.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </>}
        list={matches.length ? <ul className="grid gap-1">
          {matches.map(({ name, versions, target: item }) => {
            const active = name === activeName
            const route: Route = { name: 'admin', view: 'datasets', resourceId: name, version: item.version }
            return <li key={name} className="min-w-0">
              <a {...linkTo(route, next => {
                jumpOnSelect.current = true
                navigate(next)
                if (item.version === selected?.version) {
                  jumpOnSelect.current = false
                  if (window.matchMedia?.('(max-width: 1023px)').matches) detailRef.current?.scrollIntoView?.({ block: 'start' })
                }
              })} aria-current={active ? 'page' : undefined} className={catalogRowClass}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-foreground" title={name}>{name}</strong>
                  <p className="mt-1 truncate text-[11px] text-foreground-3">{versions.length} 个版本 · {item.schema}</p>
                </div>
                {active ? <ChevronRight aria-hidden="true" className="text-foreground-3" size={14}/> : null}
              </a>
            </li>
          })}
        </ul> : <p className="px-3 py-8 text-center text-sm text-foreground-3">{catalog.length ? '没有匹配的数据集' : '尚无已登记数据集'}</p>}
        detail={selected ? <AdminDatasetDetailPage key={selected.version} selected={selected}
          versions={options} onSelect={selectVersion} onShared={shareVersion} onDerived={id => {
            refresh()
            navigate({ name: 'admin', view: 'datasets', resourceId: selected.dataset, version: id })
          }} navigate={navigate} expired={expired}/>
          : loading ? <p className="text-sm text-foreground-3" role="status">正在读取版本…</p>
          : dataset ? <EmptyState title={options.length ? '找不到这个版本' : '找不到这个数据集'} description={version ?? dataset}>
            <Button type="button" variant="outline" onClick={() => navigate({ name: 'admin', view: 'datasets' }, true)}>查看目录</Button>
          </EmptyState> : <EmptyState title="选择数据集查看详情"/>}
      />}

    {cleanupOpen ? <AdminDatasetCleanupDialog onClose={() => setCleanupOpen(false)} onChanged={refresh} expired={expired}/> : null}
  </section>
}
