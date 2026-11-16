import { Button } from '@/components/ui/button'
import { useState } from 'react'


type Row = Record<string, unknown>
const label = (value: unknown) => typeof value === 'string' ? value : '未提供'

export function ModelPolicyCards({ models, busy, update, open }: {
  models: Row[]
  busy: boolean
  update: (id: string, changes: { enabled?: boolean; isDefault?: boolean }) => Promise<void>
  open?: (id: string) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{models.map(model => {
    const enabled = model.enabled !== false
    const compatible = model.state === 'ready' && ['openstack-six-v1', 'kamei14-git-v1'].includes(label(model.featureSchemaVersion))
    const isDefault = model.isDefault === true
    return <article className="admin-model-card grid gap-2 rounded-md border border-border-soft bg-card p-card" data-default={isDefault} data-disabled={!enabled} key={label(model.modelId)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{!enabled ? '已停用' : model.state === 'ready' ? '已校验' : '不可用'}</span>
        {isDefault ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">默认模型</span> : null}
        {enabled && !compatible ? <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">不适用于当前仓库</span> : null}
      </div>
      <h3>{label(model.name)}</h3>
      <p className="text-xs text-foreground-3">{label(model.method)}</p>
      <dl className="grid gap-1 text-xs [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:text-right [&_dd]:break-all">
        <div><dt>特征 schema</dt><dd>{label(model.featureSchemaVersion)}</dd></div>
        <div><dt>模型 ID</dt><dd><code>{label(model.modelId)}</code></dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {open ? <Button size="sm" onClick={() => open(label(model.modelId))} variant="outline" type="button">查看详情</Button> : null}
        <Button size="sm" disabled={busy || isDefault || !compatible || !enabled} onClick={() => void update(label(model.modelId), { isDefault: true })} variant="outline" type="button">{isDefault ? '当前默认' : '设为默认'}</Button>
        <Button variant="link" size="sm" disabled={busy || isDefault || !enabled && !compatible} onClick={() => enabled ? setConfirmId(label(model.modelId)) : void update(label(model.modelId), { enabled: true })} type="button">{enabled ? '停用模型' : '启用模型'}</Button>
      </div>
      {confirmId === model.modelId ? <div className="grid gap-2 rounded-sm border border-border-soft p-2.5 text-xs border-rose/30 bg-rose-soft" role="group" aria-label="确认停用模型"><strong>停用「{label(model.name)}」？</strong><p>已完成结果保留。新分析不能选择此模型；未开始使用该模型的任务将报告停用原因，已开始使用的任务可以完成。</p><Button size="sm" disabled={busy} onClick={() => { setConfirmId(null); void update(label(model.modelId), { enabled: false }) }} variant="destructive" type="button">确认停用</Button><Button size="sm" aria-label="取消" disabled={busy} onClick={() => setConfirmId(null)} variant="outline" type="button">取消</Button></div> : null}
    </article>
  })}</div>
}
