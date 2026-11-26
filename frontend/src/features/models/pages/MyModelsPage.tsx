import { WorkspacePageHeader } from '@/components/layout/WorkspacePageHeader'
import { CopyIdentifier } from '@/components/shared/CopyIdentifier'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { userModels, useUserRevision, type UserModel } from '@/features/account/userClient'
import { EmptyState, FailureNotice } from '@/components/shared/Feedback'
import { CardListSkeleton } from '@/components/shared/Skeletons'

import { ModelCardDialog } from '@/features/models/components/ModelCardDialog'
import { trainingMethodName } from '@/features/training/trainingPresentation'
import type { Route } from '@/app/navigation'

function paramsText(parameters: Record<string, unknown> | null): string {
  if (!parameters) return '默认参数'
  return Object.entries(parameters).filter(([key]) => !['threads', 'seed', 'solver', 'tol', 'regularization', 'class_weight'].includes(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : value}`).join(' · ')
}

function ModelRow({ model, openCard, navigate }: {
  model: UserModel
  openCard: (id: string) => void
  navigate: (route: Route) => void
}) {
  return <article className="grid gap-1.5 rounded-xl border border-border-soft bg-card p-card">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-sm font-medium text-foreground">{model.name}</strong>
      <span className="text-xs text-foreground-3"><Button size="sm" variant="link" className="h-auto p-0 text-xs font-normal" onClick={() => navigate({ name: 'algorithms', method: model.method })} type="button">{trainingMethodName(model.method)}</Button> · {model.featureSchemaVersion}</span>
    </div>
    <code className="break-all font-mono text-[11px] text-foreground-3">{paramsText(model.parameters)}</code>
    <div className="flex flex-wrap items-center gap-2">
      <span className={model.state === 'ready' ? 'rounded-sm bg-teal-soft px-1.5 py-0.5 text-[11px] text-teal-deep' : 'rounded-sm bg-rose-soft px-1.5 py-0.5 text-[11px] text-rose-deep'}>{model.state === 'ready' ? '已校验' : '不可用'}</span>
      <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{model.enabled ? '已启用' : '已停用'}</span>
      {!model.mine ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">管理员开放</span>
        : model.shared ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">已开放</span> : null}
      <Button size="sm" variant="ghost" onClick={() => openCard(model.modelId)} type="button">查看模型卡</Button>
    </div>
    {model.mine && model.datasetVersion ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 border-t border-border-soft pt-1.5">
      <CopyIdentifier value={model.datasetVersion} label="训练数据版本"/>
      <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => navigate({ name: 'my-data', datasetVersion: model.datasetVersion! })} type="button">打开训练数据</Button>
    </div> : null}
  </article>
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
  const mine = models.filter(model => model.mine)
  const shared = models.filter(model => !model.mine && model.shared)
  const meta = [mine.length ? `${mine.length} 个我的模型` : null, shared.length ? `${shared.length} 个管理员开放` : null]
    .filter(Boolean).join(' · ') || '没有可选模型'
  return <section className="mx-auto grid w-full max-w-[68rem] gap-5">
    <WorkspacePageHeader title="我的模型" meta={meta}/>
    {!models.length ? <EmptyState title="还没有自己的模型" description="完成训练后，登记结果即可在这里查看；管理员开放的模型也会出现在这里。">
      <Button variant='default' onClick={() => navigate({ name: 'my-training' })} type="button">去训练</Button>
    </EmptyState> : <>
      {mine.length ? <section className="grid gap-2" aria-label="我的模型">
        <h2 className="text-sm font-semibold text-foreground">我的模型 <span className="font-normal text-foreground-3">{mine.length}</span></h2>
        {mine.map(model => <ModelRow key={model.modelId} model={model} openCard={setCardId} navigate={navigate}/>)}
      </section> : null}
      {shared.length ? <section className="grid gap-2" aria-label="管理员开放的模型">
        <h2 className="text-sm font-semibold text-foreground">管理员开放 <span className="font-normal text-foreground-3">{shared.length}</span></h2>
        {shared.map(model => <ModelRow key={model.modelId} model={model} openCard={setCardId} navigate={navigate}/>)}
      </section> : null}
    </>}
    <ModelCardDialog modelId={cardId} open={Boolean(cardId)} onOpenChange={open => { if (!open) setCardId('') }}/>
  </section>
}
