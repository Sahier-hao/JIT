import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, NetworkError, record } from '../../apiContract'
import { apiRequest } from '../../apiClient'
import {
  fetchAdminModels,
  fetchModelCoverage,
  type CoverageState,
  type ModelCoveragePage,
  type ModelPackageImport,
  type ModelReadiness,
  type Row,
} from '../../adminContracts'
import { Button } from '../../ui/controls'
import { EmptyState, LoadingNotice } from '../../Feedback'
import type { Route } from '../../navigation'
import { ModelPolicyCards } from '../ModelPolicyCards'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const label = (value: unknown) => typeof value === 'string' ? value : '未提供'

export function AdminModelsPage({ navigate, expired }: {
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [models, setModels] = useState<Row[]>([])
  const [methods, setMethods] = useState<Row[]>([])
  const [candidates, setCandidates] = useState<Row[]>([])
  const [readiness, setReadiness] = useState<ModelReadiness | null>(null)
  const [coverage, setCoverage] = useState<ModelCoveragePage | null>(null)
  const [coverageError, setCoverageError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.allSettled([
      fetchAdminModels(controller.signal),
      fetchModelCoverage(controller.signal),
    ]).then(([catalogResult, coverageResult]) => {
      if (controller.signal.aborted) return
      if (catalogResult.status === 'fulfilled') {
        const result = catalogResult.value
        setModels(result.models as unknown as Row[])
        setMethods(result.methods)
        setCandidates(result.candidates)
        setReadiness(result.readiness)
        setError('')
      } else {
        const failure = catalogResult.reason
        if (failure instanceof ApiError && failure.status === 401) expired()
        else if (failure instanceof NetworkError) setError('无法连接模型后端，请检查服务后重试。')
        else setError(failure instanceof Error ? failure.message : '读取模型目录失败')
      }
      if (coverageResult.status === 'fulfilled') {
        setCoverage(coverageResult.value)
        setCoverageError('')
      } else {
        const failure = coverageResult.reason
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setCoverageError(failure instanceof NetworkError
          ? '无法连接训练覆盖接口。'
          : failure instanceof Error ? failure.message : '读取训练覆盖失败')
      }
      setLoading(false)
    })
    return () => controller.abort()
  }, [revision, expired])

  async function register(candidate: Row) {
    if (lock.current) return
    lock.current = true
    setBusy(label(candidate.candidateId))
    setError('')
    setNotice('')
    try {
      await apiRequest({
        path: '/api/v1/models/register',
        method: 'POST',
        body: { candidateId: candidate.candidateId, expectedManifestSha256: candidate.manifestSha256 },
      })
      setNotice('产物校验通过，已登记。')
      setRevision(value => value + 1)
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '登记失败')
    } finally {
      lock.current = false
      setBusy('')
    }
  }

  const updatePolicy = useCallback(async (modelId: string, changes: { enabled?: boolean; isDefault?: boolean }) => {
    if (lock.current) return
    lock.current = true
    setBusy(modelId)
    setError('')
    setNotice('')
    try {
      const saved = record(await apiRequest({ path: `/api/v1/models/${encodeURIComponent(modelId)}/policy`, method: 'PATCH', body: changes }))
      setModels(previous => previous.map(model => ({ ...model,
        ...(saved.isDefault === true ? { isDefault: model.modelId === modelId } : {}),
        ...(model.modelId === modelId ? saved : {}),
      })))
      setNotice(changes.isDefault ? '默认模型已更新；已排队任务保持原模型。' : changes.enabled ? '模型已启用。' : '模型已停用，历史结果保留。')
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型设置保存失败')
    } finally {
      lock.current = false
      setBusy('')
    }
  }, [expired])

  if (loading) return <section>
    <AdminPageHeader title="模型管理" onRefresh={() => setRevision(value => value + 1)}/>
    <LoadingNotice label="正在读取模型目录"/>
  </section>
  if (error && !models.length) return <EmptyState title="无法读取模型目录" description={error}><Button onClick={() => setRevision(value => value + 1)}>重试</Button></EmptyState>
  return <section>
    <AdminPageHeader title="模型管理" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    {notice ? <p role="status" className="admin-notice">{notice}</p> : null}
    {readiness ? <section className="admin-visibility-summary" aria-label="模型可见性">
      <VisibilitySummary readiness={readiness}/>
    </section> : null}
    {readiness && readiness.issues.length ? <section className="admin-readiness" aria-label="模型目录就绪状态">
      <strong>模型目录需要处理 {readiness.issues.length} 项</strong>
      <ul>{readiness.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>
      {readiness.unregisteredExperiments ? <Button onClick={() => navigate({ name: 'admin', view: 'experiment-runs', registrationState: 'unregistered', artifactState: 'complete' })}>查看未登记实验</Button> : null}
    </section> : null}
    {readiness ? <CatalogState readiness={readiness} imported={coverage?.latestImport ?? null}
      coverageKnown={coverage !== null}/> : null}
    {coverageError ? <section className="admin-panel model-coverage-error" aria-label="训练覆盖读取失败">
      <strong>训练覆盖暂不可用</strong><p>{coverageError}</p>
      <Button size="sm" onClick={() => setRevision(value => value + 1)}>重试</Button>
    </section> : null}
    {coverage ? <CoverageMatrix page={coverage} openModel={modelId => navigate({ name: 'admin', view: 'models', resourceId: modelId })}/> : null}
    {coverage ? <ModelPackageDelivery latest={coverage.latestImport}/> : null}
    <h2 className="admin-section-title">已登记模型 <span className="admin-count">{models.length}</span></h2>
    <ModelPolicyCards models={models} busy={!!busy} update={updatePolicy} open={modelId => navigate({ name: 'admin', view: 'models', resourceId: modelId })}/>
    {!models.length ? <p className="quiet-empty">尚无已登记模型</p> : null}
    <MethodAvailability methods={methods}/>
    <h2 className="admin-section-title">本机模型产物</h2>
    <div className="admin-candidates">{candidates.map(candidate => <article className="admin-candidate" key={label(candidate.candidateId)}>
      <div><strong>{label(candidate.displayName)}</strong><p>{label(candidate.method)} · {label(candidate.featureSchemaVersion)}</p></div>
      <Button disabled={!!busy || candidate.state === 'invalid'} onClick={() => void register(candidate)}>{busy === candidate.candidateId ? '正在校验…' : '登记本机产物'}</Button>
    </article>)}</div>
    {!candidates.length ? <p className="quiet-empty">当前产物目录没有可发现的模型</p> : null}
  </section>
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
  return <div className="admin-status-line" aria-label="模型可见性">
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
  return <section className="admin-panel catalog-empty-state" aria-label="模型目录为空">
    <strong>尚无已登记模型</strong>
    <p>{hasCandidates
      ? '本机已有训练产物，但还没有登记为可用模型。'
      : !coverageKnown
        ? '目录库没有已登记模型；模型包导入状态暂不可读。'
      : imported
        ? '最近一次模型包没有登记成功，请核对下方逐项原因。'
        : '当前部署环境没有模型包导入记录，也没有已登记模型。'}</p>
  </section>
}

function CoverageMatrix({ page, openModel }: {
  page: ModelCoveragePage
  openModel: (modelId: string) => void
}) {
  if (!page.datasets.length) return <section className="admin-panel model-coverage-empty" aria-label="训练覆盖">
    <strong>没有训练覆盖记录</strong><p>当前产物目录没有套件索引或完整运行。</p>
  </section>
  return <section className="model-coverage" aria-label="数据集与方法训练覆盖">
    <h2 className="admin-section-title">训练覆盖 <span className="admin-count">{page.total}</span></h2>
    <div className="model-coverage-datasets">{page.datasets.map(dataset =>
      <article className="model-coverage-dataset" key={dataset.datasetKey}>
        <header><strong>{dataset.dataset}</strong><span>{dataset.datasetVersion} · {dataset.schema}</span></header>
        <div className="model-coverage-grid" role="list">
          {dataset.methods.map(cell => <div role="listitem" key={cell.method}>
            <strong>{cell.name}</strong>
            <CoverageCell cell={cell} openModel={openModel}/>
          </div>)}
        </div>
      </article>)}</div>
    <p className="model-coverage-note">覆盖来自真实运行和产物校验；未登记项不会自动发布或设为默认。</p>
  </section>
}

function CoverageCell({ cell, openModel }: {
  cell: ModelCoveragePage['datasets'][number]['methods'][number]
  openModel: (modelId: string) => void
}) {
  const content = <>
    <span className="coverage-state" data-state={cell.state}>{COVERAGE_LABELS[cell.state]}</span>
    {cell.reason ? <small title={cell.reason}>{cell.reason}</small> : null}
  </>
  if (cell.modelId) return <button type="button" className="coverage-cell-button"
    aria-label={`${cell.name}：${COVERAGE_LABELS[cell.state]}，查看模型详情`}
    onClick={() => openModel(cell.modelId!)}>{content}</button>
  return <div className="coverage-cell-static" title={cell.reason ?? undefined}>{content}</div>
}

function ModelPackageDelivery({ latest }: { latest: ModelPackageImport | null }) {
  const failures = latest?.items.filter(item => item.status === 'conflict' || item.status === 'failed') ?? []
  return <section className="admin-panel model-package-panel" aria-label="模型包交付">
    <h2 className="admin-section-title">模型包恢复</h2>
    {latest ? <>
      <div className="admin-status-line">
        <span>{latest.packageName}</span><span>{latest.status === 'completed' ? '导入完成' : latest.status === 'partial' ? '部分导入' : '导入失败'}</span>
        <span>新建 {latest.registeredCount}</span><span>复用 {latest.reusedCount}</span><span>已存在 {latest.alreadyRegisteredCount}</span>
      </div>
      <div className="model-package-identity"><span>SHA-256</span><code>{latest.packageSha256}</code></div>
      {latest.message ? <p>{latest.message}</p> : null}
      {failures.length ? <ul className="model-package-failures">{failures.map((item, index) =>
        <li key={`${item.artifactRunId ?? item.artifactKey ?? 'item'}-${index}`}><code>{item.artifactKey ?? item.artifactRunId ?? '未知条目'}</code><span>{item.message ?? item.code ?? '导入失败'}</span></li>)}</ul> : null}
    </> : <p>尚无模型包导入记录。</p>}
    <details><summary>维护命令</summary><pre>{`python -m jit_baseline.cli export-models <MODEL_ID...> --output models.zip
python -m jit_baseline.cli import-models models.zip`}</pre></details>
  </section>
}

function MethodAvailability({ methods }: { methods: Row[] }) {
  if (!methods.length) return null
  return <section className="admin-panel method-availability" aria-label="方法支持情况"><h2 className="admin-section-title">方法支持情况 <span className="admin-count">{methods.length}</span></h2><ul>{methods.map(method => <li key={label(method.method)}><div><strong>{label(method.name)}</strong><span>{method.category === 'deep' ? '深度学习' : '经典机器学习'}</span></div><span className="admin-status-chip">{Number(method.registeredModels) > 0 ? `已校验模型 ${method.registeredModels}` : Number(method.deliveredArtifacts) > 0 ? '待校验登记' : '无已交付产物'}</span></li>)}</ul></section>
}
