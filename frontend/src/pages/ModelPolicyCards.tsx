import { useState } from 'react'
import { Button } from '../ui/controls'

type Row = Record<string, unknown>
const label = (value: unknown) => typeof value === 'string' ? value : '未提供'

export function ModelPolicyCards({ models, busy, update, open }: {
  models: Row[]
  busy: boolean
  update: (id: string, changes: { enabled?: boolean; isDefault?: boolean }) => Promise<void>
  open?: (id: string) => void
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return <div className="admin-model-grid">{models.map(model => {
    const enabled = model.enabled !== false
    const compatible = model.state === 'ready' && ['openstack-six-v1', 'kamei14-git-v1'].includes(label(model.featureSchemaVersion))
    const isDefault = model.isDefault === true
    return <article className="admin-model-card" data-default={isDefault} data-disabled={!enabled} key={label(model.modelId)}>
      <div className="model-state-row">
        <span className="source-chip">{!enabled ? '已停用' : model.state === 'ready' ? '已校验' : '不可用'}</span>
        {isDefault ? <span className="model-default-badge">默认模型</span> : null}
        {enabled && !compatible ? <span className="admin-status-chip">不适用于当前仓库</span> : null}
      </div>
      <h3>{label(model.name)}</h3>
      <p className="admin-model-method">{label(model.method)}</p>
      <dl className="admin-model-facts">
        <div><dt>特征 schema</dt><dd>{label(model.featureSchemaVersion)}</dd></div>
        <div><dt>模型 ID</dt><dd><code>{label(model.modelId)}</code></dd></div>
      </dl>
      <div className="model-policy-actions">
        {open ? <Button size="sm" onClick={() => open(label(model.modelId))}>查看详情</Button> : null}
        <Button size="sm" disabled={busy || isDefault || !compatible || !enabled} onClick={() => void update(label(model.modelId), { isDefault: true })}>{isDefault ? '当前默认' : '设为默认'}</Button>
        <Button variant="link" size="sm" disabled={busy || isDefault || !enabled && !compatible} onClick={() => enabled ? setConfirmId(label(model.modelId)) : void update(label(model.modelId), { enabled: true })}>{enabled ? '停用模型' : '启用模型'}</Button>
      </div>
      {confirmId === model.modelId ? <div className="record-confirm model-disable-confirm" role="group" aria-label="确认停用模型"><strong>停用「{label(model.name)}」？</strong><p>已完成结果保留。新分析不能选择此模型；未开始使用该模型的任务将报告停用原因，已开始使用的任务可以完成。</p><Button danger size="sm" disabled={busy} onClick={() => { setConfirmId(null); void update(label(model.modelId), { enabled: false }) }}>确认停用</Button><Button size="sm" aria-label="取消" disabled={busy} onClick={() => setConfirmId(null)}>取消</Button></div> : null}
    </article>
  })}</div>
}
