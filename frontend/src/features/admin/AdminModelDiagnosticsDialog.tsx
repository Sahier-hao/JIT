import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingNotice } from '@/components/shared/Feedback'
import { apiRequest } from '@/lib/apiClient'
import { ApiError, NetworkError } from '@/lib/apiContract'
import type { Route } from '@/app/navigation'
import { fetchModelCoverage, fetchModelDiagnostics, type AdminModel, type CoverageState, type ModelCoveragePage, type ModelPackageImport, type ModelReadiness, type Row } from '@/features/admin/adminContracts'
import { ErrorNotice } from '@/features/admin/AdminShared'

const label = (value: unknown) => typeof value === 'string' ? value : '未提供'

export function AdminModelDiagnosticsDialog({ onClose, restoreFocus, onVerified, onRegistered, navigate, expired }: {
  onClose: () => void
  restoreFocus: () => void
  onVerified: (models: AdminModel[]) => void
  onRegistered: () => void
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof fetchModelDiagnostics>> | null>(null)
  const [coverage, setCoverage] = useState<ModelCoveragePage | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState('')
  const [coverageError, setCoverageError] = useState('')
  const [registrationError, setRegistrationError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const [coverageRevision, setCoverageRevision] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setDiagnosticsError('')
    fetchModelDiagnostics(controller.signal).then(result => {
      if (controller.signal.aborted) return
      setDiagnostics(result)
      onVerified(result.models)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setDiagnosticsError(failure instanceof Error ? failure.message : '读取产物诊断失败')
    })
    return () => controller.abort()
  }, [expired, onVerified, revision])

  useEffect(() => {
    const controller = new AbortController()
    setCoverageError('')
    fetchModelCoverage(controller.signal).then(result => {
      if (!controller.signal.aborted) setCoverage(result)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else if (failure instanceof NetworkError && !failure.timedOut) setCoverageError('无法连接训练覆盖接口。')
      else setCoverageError(failure instanceof Error ? failure.message : '读取训练覆盖失败')
    })
    return () => controller.abort()
  }, [expired, revision, coverageRevision])

  async function register(candidate: Row) {
    if (lock.current) return
    lock.current = true
    setBusy(label(candidate.candidateId))
    setNotice('')
    setRegistrationError('')
    try {
      await apiRequest({
        path: '/api/v1/models/register', method: 'POST',
        body: { candidateId: candidate.candidateId, expectedManifestSha256: candidate.manifestSha256 },
      })
      setNotice('产物校验通过，已登记。')
      onRegistered()
      setRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setRegistrationError(failure instanceof Error ? failure.message : '登记失败')
    } finally { lock.current = false; setBusy('') }
  }

  const readiness = diagnostics?.readiness
  const coverageStatus = coverageError ? <div className="grid justify-items-start gap-2">
    <ErrorNotice>{coverageError}</ErrorNotice>
    <Button type="button" variant="outline" size="sm" onClick={() => setCoverageRevision(value => value + 1)}>重试读取训练覆盖</Button>
  </div> : !coverage ? <LoadingNotice label="训练覆盖"/> : null

  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] min-w-0 overflow-y-auto sm:max-w-[780px]"
      onCloseAutoFocus={event => { event.preventDefault(); restoreFocus() }}>
      <DialogHeader className="pr-6">
        <DialogTitle>产物诊断</DialogTitle>
        <DialogDescription className="sr-only">查看模型目录校验结果、训练覆盖、模型包和本机产物。</DialogDescription>
      </DialogHeader>
      <Tabs defaultValue="status" className="min-w-0">
        <TabsList aria-label="诊断视图" className="h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="status" className="text-xs">目录状态</TabsTrigger>
          <TabsTrigger value="coverage" className="text-xs">训练覆盖</TabsTrigger>
          <TabsTrigger value="packages" className="text-xs">模型包</TabsTrigger>
          <TabsTrigger value="artifacts" className="text-xs">本机产物</TabsTrigger>
        </TabsList>
        {diagnosticsError ? <div className="grid justify-items-start gap-2"><ErrorNotice>{diagnosticsError}</ErrorNotice>
          <Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重试产物诊断</Button>
        </div> : null}
        <TabsContent value="status" className="grid min-w-0 gap-3">
          {readiness ? <>
            <VisibilitySummary readiness={readiness}/>
            {readiness.issues.length ? <section className="grid gap-2 rounded-lg border border-border-soft p-3" aria-label="模型目录就绪状态">
              <strong className="text-sm">模型目录需要处理 {readiness.issues.length} 项</strong>
              <ul className="grid gap-1 text-xs text-foreground-3">{readiness.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>
              {readiness.unregisteredExperiments ? <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={!!busy}
                onClick={() => navigate({ name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', artifactState: 'complete' })}>查看未登记实验</Button> : null}
            </section> : null}
            <CatalogState readiness={readiness} imported={coverage?.latestImport ?? null} coverageKnown={coverage !== null}/>
            {diagnostics.methods.length ? <details className="rounded-lg border border-border-soft p-3">
              <summary className="cursor-pointer text-sm font-medium">支持的训练方法</summary>
              <div className="mt-2"><MethodAvailability methods={diagnostics.methods}/></div>
            </details> : null}
          </> : !diagnosticsError ? <LoadingNotice label="产物诊断"/> : null}
        </TabsContent>
        <TabsContent value="coverage" className="grid min-w-0 gap-2">
          {coverageStatus}
          {coverage ? <CoverageMatrix page={coverage} openModel={id => navigate({ name: 'admin', view: 'models', resourceId: id })}/> : null}
        </TabsContent>
        <TabsContent value="packages" className="grid min-w-0 gap-2">
          {coverageStatus}
          {coverage ? <ModelPackageDelivery latest={coverage.latestImport}/> : null}
        </TabsContent>
        <TabsContent value="artifacts" className="grid min-w-0 gap-2">
          <h3 className="text-sm font-semibold">本机模型产物</h3>
          <ErrorNotice>{registrationError}</ErrorNotice>
          {notice ? <p className="text-xs text-foreground-3" role="status">{notice}</p> : null}
          {diagnostics ? diagnostics.candidates.length ? <ul className="grid gap-2">
            {diagnostics.candidates.map(candidate => <li key={label(candidate.candidateId)}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border-soft p-3 text-xs">
              <div className="min-w-0">
                <strong className="break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">{label(candidate.displayName)}</strong>
                <p className="text-foreground-3">{label(candidate.method)} · {label(candidate.featureSchemaVersion)}</p>
              </div>
              <Button disabled={!!busy || candidate.state === 'invalid'} onClick={() => void register(candidate)} variant="outline" size="sm" type="button">
                {busy === candidate.candidateId ? '正在校验…' : '登记本机产物'}
              </Button>
            </li>)}
          </ul> : <p className="text-xs text-foreground-3">当前产物目录没有可发现的模型</p>
            : !diagnosticsError ? <LoadingNotice label="本机产物"/> : null}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
}

const COVERAGE_LABELS: Record<CoverageState, string> = {
  missing: '无产物',
  failed: '训练失败',
  invalid: '产物无效',
  'offline-only': '离线基准',
  'input-unsupported': '输入不支持',
  incompatible: 'schema 不兼容',
  'complete-unregistered': '已训练未登记',
  'registered-ready': '可用',
  'registered-unavailable': '已登记不可用',
}

function VisibilitySummary({ readiness }: { readiness: ModelReadiness }) {
  return <div className="flex flex-wrap items-center gap-2.5 text-xs text-foreground-3" aria-label="模型可见性">
    <span>{readiness.registeredModels} 个已登记</span>
    <span>{readiness.readyModels} 个可用模型</span>
    <span>{readiness.userSelectableModels} 个用户可选</span>
    <span>{readiness.completeUnregisteredExperiments} 个完整未登记</span>
    <span>{readiness.invalidArtifacts + readiness.invalidModels} 个无效项</span>
  </div>
}

function CatalogState({ readiness, imported, coverageKnown }: {
  readiness: ModelReadiness
  imported: ModelPackageImport | null
  coverageKnown: boolean
}) {
  if (readiness.registeredModels > 0) return null
  const hasCandidates = readiness.completeUnregisteredExperiments > 0 || readiness.invalidArtifacts > 0
  return <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card text-xs text-foreground-3" aria-label="模型目录为空">
    <strong>尚无已登记模型</strong>
    <p>{hasCandidates
      ? '本机已有训练产物，但还没有登记为可用模型。'
      : !coverageKnown
        ? '目录库没有已登记模型；模型包导入状态暂不可读。'
      : imported
        ? '最近一次模型包没有登记成功，在「模型包」中查看逐项原因。'
        : '当前部署环境没有模型包导入记录，也没有已登记模型。'}</p>
  </section>
}

function CoverageMatrix({ page, openModel }: {
  page: ModelCoveragePage
  openModel: (modelId: string) => void
}) {
  if (!page.datasets.length) return <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card text-xs text-foreground-3" aria-label="训练覆盖">
    <strong>没有训练覆盖记录</strong><p>当前产物目录没有套件索引或完整运行。</p>
  </section>
  return <section className="model-coverage" aria-label="数据集与方法训练覆盖">
    <h2 className="text-base font-semibold text-foreground">训练覆盖 <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{page.total}</span></h2>
    <div className="mt-2 grid gap-2">{page.datasets.map((dataset, index) =>
      <details className="rounded-lg border border-border-soft p-3 text-xs" key={dataset.datasetKey} open={index === 0}>
        <summary className="cursor-pointer break-words font-medium [overflow-wrap:anywhere]">{dataset.dataset} <span className="text-xs font-normal text-foreground-3">· {dataset.datasetVersion}</span></summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="list">
          {dataset.methods.map(cell => <div className="grid gap-1 rounded-sm border border-border-soft p-2" role="listitem" key={cell.method}>
            <strong className="text-xs font-medium text-foreground">{cell.name}</strong>
            <CoverageCell cell={cell} openModel={openModel}/>
          </div>)}
        </div>
      </details>)}</div>
    <p className="text-xs text-foreground-3">覆盖来自真实运行和产物校验；未登记项不会自动发布或设为默认。</p>
  </section>
}

function CoverageCell({ cell, openModel }: {
  cell: ModelCoveragePage['datasets'][number]['methods'][number]
  openModel: (modelId: string) => void
}) {
  const content = <>
    <span className="text-[11px] text-foreground-3" data-state={cell.state}>{COVERAGE_LABELS[cell.state]}</span>
    {cell.reason ? <small title={cell.reason}>{cell.reason}</small> : null}
  </>
  if (cell.modelId) return <Button variant="ghost" type="button" className="h-auto min-w-0 block w-full whitespace-normal border-0 bg-transparent p-0 text-left"
    aria-label={`${cell.name}：${COVERAGE_LABELS[cell.state]}，查看模型详情`}
    onClick={() => openModel(cell.modelId!)}>{content}</Button>
  return <div className="block" title={cell.reason ?? undefined}>{content}</div>
}

function ModelPackageDelivery({ latest }: { latest: ModelPackageImport | null }) {
  const failures = latest?.items.filter(item => item.status === 'conflict' || item.status === 'failed') ?? []
  return <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card" aria-label="模型包交付">
    <h2 className="text-base font-semibold text-foreground">模型包恢复</h2>
    {latest ? <>
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-foreground-3">
        <span>{latest.packageName}</span><span>{latest.status === 'completed' ? '导入完成' : latest.status === 'partial' ? '部分导入' : '导入失败'}</span>
        <span>新建 {latest.registeredCount}</span><span>复用 {latest.reusedCount}</span><span>已存在 {latest.alreadyRegisteredCount}</span>
      </div>
      <div className="grid gap-0.5 text-xs text-foreground-3"><span>SHA-256</span><code className="break-all">{latest.packageSha256}</code></div>
      {latest.message ? <p className="text-xs text-foreground-3">{latest.message}</p> : null}
      {failures.length ? <ul className="grid gap-1 text-xs text-rose">{failures.map((item, index) =>
        <li key={`${item.artifactRunId ?? item.artifactKey ?? 'item'}-${index}`}><code>{item.artifactKey ?? item.artifactRunId ?? '未知条目'}</code><span>{item.message ?? item.code ?? '导入失败'}</span></li>)}</ul> : null}
    </> : <p className="text-xs text-foreground-3">尚无模型包导入记录。</p>}
    <details className="rounded-sm border border-border-soft"><summary className="cursor-pointer px-2.5 py-1.5 text-xs text-foreground-2">维护命令</summary><pre className="overflow-auto border-t border-border-soft bg-dark p-2.5 font-mono text-[11px] text-on-dark">{`python -m jit_baseline.cli export-models <MODEL_ID...> --output models.zip
python -m jit_baseline.cli import-models models.zip`}</pre></details>
  </section>
}

function MethodAvailability({ methods }: { methods: Row[] }) {
  if (!methods.length) return null
  return <section className="grid gap-2 rounded-md border border-border-soft bg-card p-card" aria-label="方法支持情况"><h2 className="text-base font-semibold text-foreground">方法支持情况 <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{methods.length}</span></h2><ul className="grid gap-0.5">{methods.map(method => <li key={label(method.method)} className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft py-1.5 text-xs"><div className="flex flex-wrap items-baseline gap-2"><strong className="text-sm font-medium text-foreground">{label(method.name)}</strong><span className="text-xs text-foreground-3">{method.category === 'deep' ? '深度学习' : '经典机器学习'}</span></div><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{Number(method.registeredModels) > 0 ? `已校验模型 ${method.registeredModels}` : Number(method.deliveredArtifacts) > 0 ? '待校验登记' : '无已交付产物'}</span></li>)}</ul></section>
}
