import { useEffect, useState } from 'react'
import { ApiError } from '../apiContract'
import { userModels, useUserRevision, type UserModel } from '../userClient'
import { EmptyState, LoadingNotice } from '../Feedback'
import { Button } from '../ui/controls'
import { ModelCardDialog } from '../components/ModelCardDialog'
import type { Route } from '../navigation'
import '../styles/user-workspace.css'

function paramsText(parameters: Record<string, unknown> | null): string {
  if (!parameters) return '默认参数'
  return Object.entries(parameters).filter(([key]) => !['threads', 'seed', 'solver', 'tol', 'regularization', 'class_weight'].includes(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : value}`).join(' · ')
}

export function MyModelsPage({ navigate, onLoginRequired }: {
  navigate: (route: Route) => void
  onLoginRequired: () => void
}) {
  const [models, setModels] = useState<UserModel[] | null>(null)
  const [error, setError] = useState('')
  const [cardId, setCardId] = useState('')
  const userRevision = useUserRevision()
  useEffect(() => {
    const controller = new AbortController()
    userModels(controller.signal).then(value => { if (!controller.signal.aborted) setModels(value) })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure instanceof Error ? failure.message : '模型读取失败')
      })
    return () => controller.abort()
  }, [onLoginRequired, userRevision])
  if (models === null) return <section className="user-workspace">
    {error ? <div className="user-empty"><p className="field-error" role="alert">{error}</p><Button onClick={onLoginRequired}>登录后重试</Button></div>
      : <LoadingNotice label="正在读取我的模型"/>}
  </section>
  return <section className="user-workspace">
    <header className="user-page-head"><h1>我的模型</h1><span>{models.length} 个已登记模型 · 只在本人项目可选</span></header>
    {!models.length ? <EmptyState title="还没有自己的模型" description="在「我的数据」训练并显式登记后，模型会出现在这里。">
      <Button variant="primary" onClick={() => navigate({ name: 'my-data' })}>去训练</Button>
    </EmptyState> : <div className="user-model-list">{models.map(model => <article key={model.modelId} className="user-model-card">
      <div><strong>{model.name}</strong><span>{model.method} · {model.featureSchemaVersion}</span></div>
      <code>{paramsText(model.parameters)}</code>
      <div className="user-inline"><span className="source-chip">{model.state === 'ready' ? '已校验' : '不可用'}</span><span className="source-chip">{model.enabled ? '已启用' : '已停用'}</span><Button size="sm" variant="ghost" onClick={() => setCardId(model.modelId)}>查看模型卡</Button></div>
      {model.datasetVersion ? <p className="quiet-empty">训练数据：{model.datasetVersion}</p> : null}
    </article>)}</div>}
    <ModelCardDialog modelId={cardId} open={Boolean(cardId)} onOpenChange={open => { if (!open) setCardId('') }}/>
  </section>
}
