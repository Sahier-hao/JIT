import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { CopyIdentifier } from '@/components/shared/CopyIdentifier'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { userModels, useUserRevision, type UserModel } from '@/features/account/userClient'
import { EmptyState, FailureNotice } from '@/components/shared/Feedback'
import { CardListSkeleton } from '@/components/shared/Skeletons'

import { ModelCardDialog } from '@/features/models/components/ModelCardDialog'
import type { Route } from '@/app/navigation'

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
  const [error, setError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const [cardId, setCardId] = useState('')
  const userRevision = useUserRevision()
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    userModels(controller.signal).then(value => { if (!controller.signal.aborted) setModels(value) })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) onLoginRequired()
        else setError(failure)
      })
    return () => controller.abort()
  }, [onLoginRequired, userRevision, revision])
  if (models === null) return <section className="grid gap-4">
    <WorkspacePageHeader title="我的模型"/>
    {error ? <FailureNotice error={error} onRetry={() => setRevision(value => value + 1)}/>
      : <CardListSkeleton label="正在读取我的模型" rows={3}/>}
  </section>
  return <section className="mx-auto grid w-full max-w-[68rem] gap-4">
    <WorkspacePageHeader title="我的模型" meta={`${models.length} 个已登记模型 · 只在本人项目可选`}/>
    {!models.length ? <EmptyState title="还没有自己的模型" description="完成训练后，登记结果即可在这里查看。">
      <Button variant='default' onClick={() => navigate({ name: 'my-training' })} type="button">去训练</Button>
    </EmptyState> : <div className="grid gap-2">{models.map(model => <article key={model.modelId} className="grid gap-1.5 rounded-xl border border-border-soft bg-card p-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm font-medium text-foreground">{model.name}</strong><span className="text-xs text-foreground-3">{model.method} · {model.featureSchemaVersion}</span></div>
      <code className="break-all font-mono text-[11px] text-foreground-3">{paramsText(model.parameters)}</code>
      <div className="flex flex-wrap items-center gap-2"><span className={model.state === 'ready' ? 'rounded-sm bg-teal-soft px-1.5 py-0.5 text-[11px] text-teal-deep' : 'rounded-sm bg-rose-soft px-1.5 py-0.5 text-[11px] text-rose-deep'}>{model.state === 'ready' ? '已校验' : '不可用'}</span><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{model.enabled ? '已启用' : '已停用'}</span><Button size="sm" variant="ghost" onClick={() => setCardId(model.modelId)} type="button">查看模型卡</Button></div>
      {model.datasetVersion ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 border-t border-border-soft pt-1.5">
        <CopyIdentifier value={model.datasetVersion} label="训练数据版本"/>
        <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => navigate({ name: 'my-data', datasetVersion: model.datasetVersion! })} type="button">打开训练数据</Button>
      </div> : null}
    </article>)}</div>}
    <ModelCardDialog modelId={cardId} open={Boolean(cardId)} onOpenChange={open => { if (!open) setCardId('') }}/>
  </section>
}
