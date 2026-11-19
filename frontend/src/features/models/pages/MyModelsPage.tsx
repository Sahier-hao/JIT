import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { userModels, useUserRevision, type UserModel } from '@/features/account/userClient'
import { EmptyState } from '@/components/shared/Feedback'
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
  if (models === null) return <section className="grid gap-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-3">
      <h1 className="font-sans text-xl font-semibold leading-title text-foreground">我的模型</h1>
      <span className="text-xs text-foreground-3">{error ? '读取失败' : '正在读取…'}</span>
    </header>
    {error ? <div className="grid justify-items-start gap-2"><p className="text-xs text-rose" role="alert">{error}</p><Button onClick={onLoginRequired} variant="outline" type="button">登录后重试</Button></div>
      : <CardListSkeleton label="正在读取我的模型" rows={3}/>}
  </section>
  return <section className="grid gap-4">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-soft pb-3"><h1 className="font-sans text-xl font-semibold leading-title text-foreground">我的模型</h1><span className="text-xs text-foreground-3">{models.length} 个已登记模型 · 只在本人项目可选</span></header>
    {!models.length ? <EmptyState title="还没有自己的模型" description="在「我的数据」训练并显式登记后，模型会出现在这里。">
      <Button variant='default' onClick={() => navigate({ name: 'my-data' })} type="button">去训练</Button>
    </EmptyState> : <div className="grid gap-2">{models.map(model => <article key={model.modelId} className="grid gap-1.5 rounded-md border border-border-soft bg-card p-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="text-sm font-medium text-foreground">{model.name}</strong><span className="text-xs text-foreground-3">{model.method} · {model.featureSchemaVersion}</span></div>
      <code className="break-all font-mono text-[11px] text-foreground-3">{paramsText(model.parameters)}</code>
      <div className="flex flex-wrap items-center gap-2"><span className={model.state === 'ready' ? 'rounded-sm bg-teal-soft px-1.5 py-0.5 text-[11px] text-teal-deep' : 'rounded-sm bg-rose-soft px-1.5 py-0.5 text-[11px] text-rose-deep'}>{model.state === 'ready' ? '已校验' : '不可用'}</span><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{model.enabled ? '已启用' : '已停用'}</span><Button size="sm" variant="ghost" onClick={() => setCardId(model.modelId)} type="button">查看模型卡</Button></div>
      {model.datasetVersion ? <p className="text-xs text-foreground-4">训练数据：{model.datasetVersion}</p> : null}
    </article>)}</div>}
    <ModelCardDialog modelId={cardId} open={Boolean(cardId)} onOpenChange={open => { if (!open) setCardId('') }}/>
  </section>
}
