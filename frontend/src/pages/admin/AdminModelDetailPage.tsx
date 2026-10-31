import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { fetchAdminModel, formatDate, valueLabel, type AdminModel } from '../../adminContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, MetricGrid } from './AdminShared'

export function AdminModelDetailPage({ modelId, navigate, expired }: {
  modelId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [model, setModel] = useState<AdminModel | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetchAdminModel(modelId, controller.signal).then(setModel).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型详情读取失败')
    })
    return () => controller.abort()
  }, [modelId, expired])
  if (error) return <EmptyState title="模型详情不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'models' })}>返回模型列表</Button></EmptyState>
  if (!model) return <LoadingNotice label="正在校验模型与读取指标"/>
  const source = model.source ?? {}
  return <section>
    <AdminPageHeader title={model.name} meta={model.method}/>
    <div className="admin-detail-actions"><Button onClick={() => navigate({ name: 'admin', view: 'models' })}>返回模型列表</Button><Button onClick={() => navigate({ name: 'admin', view: 'comparisons', models: [model.modelId] })}>加入比较</Button></div>
    <div className="admin-status-line"><span className="source-chip">{model.state === 'ready' ? '已校验' : '不可用'}</span><span>{model.enabled ? '已启用' : '已停用'}</span>{model.isDefault ? <strong>默认模型</strong> : null}</div>
    <MetricGrid metrics={model.metrics}/>
    <div className="admin-detail-grid">
      <section><h2>身份与能力</h2><dl className="admin-facts">
        <div><dt>模型</dt><dd><code>{model.modelId}</code></dd></div>
        <div><dt>方法</dt><dd>{model.method}</dd></div>
        <div><dt>特征 schema</dt><dd>{model.featureSchemaVersion}</dd></div>
        <div><dt>业务运行</dt><dd><code>{model.runId}</code></dd></div>
        <div><dt>原产物运行</dt><dd><code>{model.artifactRunId}</code></dd></div>
        <div><dt>数据版本</dt><dd><code>{model.artifactDatasetVersion}</code></dd></div>
        <div><dt>产物位置</dt><dd><code>{model.artifactKey}</code></dd></div>
        <div><dt>指标集</dt><dd>{model.metricSet ?? '未提供'}</dd></div>
      </dl></section>
      <section><h2>训练来源</h2><dl className="admin-facts">
        <div><dt>发布者</dt><dd>{valueLabel(source.publisher)}</dd></div>
        <div><dt>来源</dt><dd>{valueLabel(source.url)}</dd></div>
        <div><dt>修订</dt><dd><code>{valueLabel(source.revision)}</code></dd></div>
        <div><dt>训练耗时</dt><dd>{model.trainingSeconds === null || model.trainingSeconds === undefined ? '未提供' : `${model.trainingSeconds.toFixed(2)} 秒`}</dd></div>
        <div><dt>阈值</dt><dd>{model.threshold ?? '未提供'}</dd></div>
      </dl></section>
    </div>
    {model.split ? <section><h2>数据切分</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>分区</th><th>样本</th><th>正例</th><th>开始</th><th>结束</th></tr></thead><tbody>{Object.entries(model.split).map(([name, raw]) => {
      const part = raw as Record<string, unknown>
      return <tr key={name}><th>{name}</th><td>{valueLabel(part.count)}</td><td>{valueLabel(part.positiveCount)}</td><td>{formatDate(part.start)}</td><td>{formatDate(part.end)}</td></tr>
    })}</tbody></table></div></section> : null}
    <section><h2>限制</h2><ul className="admin-limitations">{(model.limitations ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
  </section>
}
