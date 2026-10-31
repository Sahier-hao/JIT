import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { fetchAdminModel, fetchAdminModels, type AdminModel } from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button, Select } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, MetricComparison } from './AdminShared'

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
      if (!requestedFirst) setFirst(result.models.find(model => model.state === 'ready')?.modelId ?? '')
      if (!requestedSecond) setSecond(result.models.find(model => model.state === 'ready' && model.modelId !== (requestedFirst || result.models[0]?.modelId))?.modelId ?? '')
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
  if (error && !models.length) return <EmptyState title="模型比较不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'models' })}>返回模型列表</Button></EmptyState>
  const comparison = result?.first === first && result.second === second ? result : null
  const left = comparison?.left ?? null
  const right = comparison?.right ?? null
  const options = models.map(model => ({ value: model.modelId, label: `${model.name} · ${model.method}` }))
  return <section>
    <AdminPageHeader title="模型比较"/>
    <div className="admin-compare-picker">
      <Select ariaLabel="模型 A" value={first} onChange={setFirst} options={options}/>
      <Select ariaLabel="模型 B" value={second} onChange={setSecond} options={options}/>
      <Button disabled={!first || !second || first === second} onClick={() => navigate({ name: 'admin', view: 'comparisons', models: [first, second] })}>比较</Button>
    </div>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {left && right ? <>
      {left.featureSchemaVersion !== right.featureSchemaVersion || left.artifactDatasetVersion !== right.artifactDatasetVersion ? <p className="admin-notice" role="status">两个模型的数据版本或特征 schema 不同，指标只能并列，不能据此排名。</p> : null}
      <MetricComparison left={left.metrics ?? {}} right={right.metrics ?? {}} leftName={left.name} rightName={right.name}/>
      <div className="admin-table-wrap"><table className="admin-table"><tbody>
        <tr><th>方法</th><td>{left.method}</td><td>{right.method}</td></tr>
        <tr><th>schema</th><td>{left.featureSchemaVersion}</td><td>{right.featureSchemaVersion}</td></tr>
        <tr><th>数据版本</th><td>{left.artifactDatasetVersion}</td><td>{right.artifactDatasetVersion}</td></tr>
        <tr><th>运行</th><td><code>{left.runId}</code></td><td><code>{right.runId}</code></td></tr>
        <tr><th>状态</th><td>{left.state}</td><td>{right.state}</td></tr>
      </tbody></table></div>
    </> : <p className="quiet-empty">选择两个不同模型后并列比较。</p>}
  </section>
}
