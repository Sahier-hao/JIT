import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { linkTo, type Route } from '@/app/navigation'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { EmptyState } from '@/components/shared/Feedback'
import { MasterDetailSkeleton } from '@/components/shared/Skeletons'
import { apiRequest } from '@/lib/apiClient'
import { ApiError, NetworkError, record } from '@/lib/apiContract'
import { fetchRegisteredAdminModels, type AdminModel } from '@/features/admin/adminContracts'
import { AdminCatalogLayout, CatalogSearch, catalogRowClass } from '@/features/admin/AdminCatalogLayout'
import { AdminModelDiagnosticsDialog } from '@/features/admin/AdminModelDiagnosticsDialog'
import { AdminModelPolicyPanel, supportsRepositoryScoring } from '@/features/admin/AdminModelPolicyPanel'
import { AdminPageHeader, ErrorNotice } from '@/features/admin/AdminShared'

const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'shared', label: '已开放' },
  { value: 'selectable', label: '可用于仓库打分' },
  { value: 'disabled', label: '已停用' },
  { value: 'unavailable', label: '不可用' },
  { value: 'incompatible', label: '字段规范不兼容' },
] as const

function catalogStatus(model: AdminModel) {
  if (!model.enabled) return 'disabled'
  if (model.state !== 'ready') return 'unavailable'
  return supportsRepositoryScoring(model) ? 'selectable' : 'incompatible'
}

export function AdminModelsPage({ selectedModelId, navigate, expired }: {
  selectedModelId?: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [models, setModels] = useState<AdminModel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const lock = useRef(false)
  const diagnosticsTriggerRef = useRef<HTMLButtonElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    if (lock.current) return
    setLoading(true)
    setRevision(value => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setReadError('')
    fetchRegisteredAdminModels(controller.signal).then(result => {
      if (!controller.signal.aborted) setModels(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else if (failure instanceof NetworkError && !failure.timedOut) setReadError('无法连接模型后端，请检查服务后重试。')
      else setReadError(failure instanceof Error ? failure.message : '读取模型目录失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, expired])

  const onVerified = useCallback((verified: AdminModel[]) => {
    const byId = new Map(verified.map(model => [model.modelId, model]))
    setModels(previous => previous?.map(model => {
      const checked = byId.get(model.modelId)
      return checked ? { ...model, state: checked.state, validationMessage: checked.validationMessage } : model
    }) ?? null)
  }, [])

  useEffect(() => {
    if (detailRef.current) detailRef.current.scrollTop = 0
  }, [selectedModelId])

  async function updatePolicy(modelId: string, changes: { enabled?: boolean; isDefault?: boolean }) {
    if (lock.current || loading) return
    lock.current = true
    setBusy(modelId)
    setSaveError(null)
    setNotice('')
    try {
      const saved = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}/policy`, method: 'PATCH', body: changes }))
      setModels(previous => previous?.map(model => {
        const selected = model.modelId === modelId
        return {
          ...model,
          enabled: selected && typeof saved.enabled === 'boolean' ? saved.enabled : model.enabled,
          isDefault: saved.isDefault === true ? selected : selected && saved.isDefault === false ? false : model.isDefault,
        }
      }) ?? null)
      setNotice(changes.isDefault ? '默认模型已更新，已排队任务沿用原模型。'
        : changes.enabled ? '模型已启用。' : '模型已停用，历史结果保留。')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setSaveError({ id: modelId, message: failure instanceof Error ? failure.message : '模型设置保存失败' })
    } finally { lock.current = false; setBusy('') }
  }

  async function updateSharing(modelId: string, shared: boolean) {
    if (lock.current || loading) return
    lock.current = true
    setBusy(modelId)
    setSaveError(null)
    setNotice('')
    try {
      const saved = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}/sharing`, method: 'PUT', body: { shared } }))
      setModels(previous => previous?.map(model => model.modelId === modelId
        ? { ...model, shared: saved.shared === true } : model) ?? null)
      setNotice(shared ? '模型已对用户开放。' : '已停止开放，历史结果保留。')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setSaveError({ id: modelId, message: failure instanceof Error ? failure.message : '模型共享设置保存失败' })
    } finally { lock.current = false; setBusy('') }
  }

  const term = query.trim().toLowerCase()
  const visible = (models ?? []).filter(model =>
    (filter === 'all' || (filter === 'shared' ? model.shared : catalogStatus(model) === filter))
    && [model.name, model.method, model.featureSchemaVersion, model.artifactDatasetVersion, model.modelId].some(value => value.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
  const selected = selectedModelId ? visible.find(model => model.modelId === selectedModelId) : visible[0]
  const missing = selectedModelId && !models?.some(model => model.modelId === selectedModelId)

  return <section className="flex min-w-0 flex-col gap-4 lg:h-[calc(100dvh-10rem)] lg:min-h-[28rem]">
    <AdminPageHeader title="模型管理" onRefresh={refresh}
      actions={<Button ref={diagnosticsTriggerRef} type="button" variant="outline" size="sm" aria-haspopup="dialog" disabled={!!busy}
        onClick={() => setDiagnosticsOpen(true)}>查看产物诊断</Button>}/>
    <ErrorNotice>{readError}</ErrorNotice>
    {notice ? <p className="rounded-md border border-border-soft bg-sunken px-3 py-2 text-xs text-foreground-2" role="status">{notice}</p> : null}
    {models === null ? loading ? <MasterDetailSkeleton label="正在读取模型目录"/>
      : <EmptyState title="无法读取模型目录"><Button type="button" variant="outline" onClick={refresh}>重试</Button></EmptyState>
      : <AdminCatalogLayout directoryLabel="模型目录" listLabel="模型列表" detailLabel="选中模型" detailRef={detailRef}
        filters={<>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">已登记模型</h2>
            <span className="text-xs tabular-nums text-foreground-3">{visible.length === models.length ? `${models.length} 个` : `${visible.length} / ${models.length}`}</span>
          </div>
          <CatalogSearch label="搜索模型" placeholder="搜索名称、方法或字段规范" value={query} onChange={setQuery}/>
          <NativeSelect aria-label="模型状态" size="sm" value={filter} onChange={event => setFilter(event.target.value)}>
            {STATUS_FILTERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </NativeSelect>
        </>}
        list={visible.length ? <ul className="grid gap-1">
          {visible.map(model => {
            const active = model.modelId === selected?.modelId
            const status = catalogStatus(model)
            const remark = [model.isDefault ? '默认' : null, model.shared ? '开放' : null].filter(Boolean).join(' · ')
              || (status === 'unavailable' ? '不可用' : status === 'disabled' ? '已停用' : null)
            const target: Route = { name: 'admin', view: 'models', selectedModelId: model.modelId }
            return <li key={model.modelId} className="min-w-0">
              <a {...linkTo(target, route => {
                navigate(route)
                if (window.matchMedia?.('(max-width: 1023px)').matches) detailRef.current?.scrollIntoView?.({ block: 'start' })
              })} className={catalogRowClass} aria-current={active ? 'page' : undefined}>
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-medium text-foreground" title={model.name}>{model.name}</strong>
                  <p className="mt-1 truncate text-[11px] text-foreground-3">{model.featureSchemaVersion}</p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-foreground-3">
                  {remark ? <span className="rounded-md bg-soft px-1.5 py-0.5">{remark}</span> : null}
                  {active ? <ChevronRight aria-hidden="true" size={14}/> : null}
                </div>
              </a>
            </li>
          })}
        </ul> : <p className="px-3 py-8 text-center text-sm text-foreground-3">{models.length ? '没有匹配的模型' : '尚无已登记模型'}</p>}
        detail={selected ? <>
          {saveError?.id === selected.modelId ? <ErrorNotice>{saveError.message}</ErrorNotice> : null}
          <AdminModelPolicyPanel key={selected.modelId} model={selected} busy={loading || !!busy} saving={busy === selected.modelId} update={updatePolicy} updateSharing={updateSharing}
            open={() => navigate({ name: 'admin', view: 'models', resourceId: selected.modelId })}/>
        </> : missing ? <EmptyState title="找不到这个模型">
          <Button type="button" variant="outline" onClick={() => navigate({ name: 'admin', view: 'models' })}>查看模型目录</Button>
        </EmptyState> : <EmptyState title={models.length ? '选择列表中的模型' : '没有可管理的模型'}>
          {!models.length ? <Button type="button" variant="outline" onClick={() => navigate({ name: 'admin', view: 'experiment-runs', registrationState: 'unregistered' })}>
            查看待登记产物
          </Button> : null}
        </EmptyState>}
      />}
    {diagnosticsOpen ? <AdminModelDiagnosticsDialog onClose={() => setDiagnosticsOpen(false)}
      restoreFocus={() => diagnosticsTriggerRef.current?.focus()} onVerified={onVerified}
      onRegistered={refresh} navigate={navigate} expired={expired}/> : null}
  </section>
}
