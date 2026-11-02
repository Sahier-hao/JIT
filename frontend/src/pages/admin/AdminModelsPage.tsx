import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, record } from '../../apiContract'
import { apiRequest } from '../../apiClient'
import { fetchAdminModels, type ModelReadiness, type Row } from '../../adminContracts'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [revision, setRevision] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminModels(controller.signal).then(result => {
      if (controller.signal.aborted) return
      setModels(result.models as unknown as Row[])
      setMethods(result.methods)
      setCandidates(result.candidates)
      setReadiness(result.readiness)
      setError('')
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '读取失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
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

  if (loading) return <LoadingNotice label="正在读取模型目录"/>
  if (error && !models.length) return <EmptyState title="模型目录不可用" description={error}><Button onClick={() => setRevision(value => value + 1)}>重试</Button></EmptyState>
  return <section>
    <AdminPageHeader title="模型管理" intro="核对已登记模型的真实训练指标与运行来源，并维护项目可选策略。" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    {notice ? <p role="status" className="admin-notice">{notice}</p> : null}
    {readiness && readiness.issues.length ? <section className="admin-readiness" aria-label="模型目录就绪状态">
      <strong>模型目录需要处理 {readiness.issues.length} 项</strong>
      <ul>{readiness.issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>
      <div className="admin-status-line"><span>{readiness.completeArtifacts} 个完整产物</span><span>{readiness.unregisteredExperiments} 个未登记</span><span>{readiness.readyModels} 个可用模型</span><span>{readiness.repositorySelectableModels} 个可用于仓库分析</span></div>
      {readiness.unregisteredExperiments ? <Button onClick={() => navigate({ name: 'admin', view: 'experiments', registrationState: 'unregistered', artifactState: 'complete' })}>查看未登记实验</Button> : null}
    </section> : null}
    <h2>已登记模型 <small>{models.length}</small></h2>
    <ModelPolicyCards models={models} busy={!!busy} update={updatePolicy} open={modelId => navigate({ name: 'admin', view: 'models', resourceId: modelId })}/>
    {!models.length ? <p className="quiet-empty">尚无已登记模型，请从下方实际产物校验登记。</p> : null}
    <MethodAvailability methods={methods}/>
    <h2>本机模型产物</h2>
    <p className="form-hint">产物存在不代表已通过准入。登记会检查文件完整性、输入契约和运行环境，不会重训。</p>
    <div className="admin-candidates">{candidates.map(candidate => <article className="admin-candidate" key={label(candidate.candidateId)}>
      <div><strong>{label(candidate.displayName)}</strong><p>{label(candidate.method)} · {label(candidate.featureSchemaVersion)}</p></div>
      <Button disabled={!!busy || candidate.state === 'invalid'} onClick={() => void register(candidate)}>{busy === candidate.candidateId ? '正在校验…' : '校验并登记'}</Button>
    </article>)}</div>
    {!candidates.length ? <p className="quiet-empty">当前产物目录没有可发现的模型。</p> : null}
  </section>
}

function MethodAvailability({ methods }: { methods: Row[] }) {
  if (!methods.length) return null
  return <section className="method-availability" aria-label="方法支持情况"><h2>方法支持情况 <small>{methods.length}</small></h2><p className="form-hint">支持方法与已校验模型分别统计。</p><ul>{methods.map(method => <li key={label(method.method)}><div><strong>{label(method.name)}</strong><span className="form-hint">{method.category === 'deep' ? '深度学习' : '经典机器学习'}</span></div><span>{Number(method.registeredModels) > 0 ? `已校验模型 ${method.registeredModels}` : Number(method.deliveredArtifacts) > 0 ? '待校验登记' : '无已交付产物'}</span></li>)}</ul></section>
}
