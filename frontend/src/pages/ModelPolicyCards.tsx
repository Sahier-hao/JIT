import { useState } from 'react'

type Row = Record<string, unknown>
const label = (value: unknown) => typeof value === 'string' ? value : '未提供'

export function ModelPolicyCards({ models, busy, update }: {
  models: Row[]
  busy: boolean
  update: (id: string, changes: { enabled?: boolean; isDefault?: boolean }) => Promise<void>
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  return <>
    <p className="form-hint">明确指定模型优先。未指定时，现成模型策略及自动策略的回退使用默认模型。停用默认模型前，请先设置另一个默认模型。</p>
    <div className="admin-model-grid">{models.map(model => {
      const enabled = model.enabled !== false
      const compatible = model.state === 'ready' && ['openstack-six-v1', 'kamei14-git-v1'].includes(label(model.featureSchemaVersion))
      const isDefault = model.isDefault === true
      return <article className="admin-model-card" data-default={isDefault} data-disabled={!enabled} key={label(model.modelId)}>
        <div className="model-state-row"><span className="source-chip">{!enabled ? '已停用' : model.state === 'ready' ? '已校验' : '不可用'}</span>{isDefault ? <span className="model-default-badge">默认模型</span> : null}</div>
        <h3>{label(model.name)}</h3><p>{label(model.method)}</p><p>{label(model.featureSchemaVersion)}</p>
        <p className="form-hint">{!enabled ? '仅保留历史结果，新分析不可选择' : compatible ? '可用于项目分析' : '不适用于当前仓库输入或需要重新校验'}</p>
        <div className="model-policy-actions"><button className="clear-button" disabled={busy || isDefault || !compatible || !enabled} onClick={() => void update(label(model.modelId), { isDefault: true })}>{isDefault ? '当前默认' : '设为默认'}</button>
          <button className="text-button" disabled={busy || isDefault || !enabled && !compatible} onClick={() => enabled ? setConfirmId(label(model.modelId)) : void update(label(model.modelId), { enabled: true })}>{enabled ? '停用模型' : '启用模型'}</button></div>
        {isDefault ? <p className="form-hint">设定其他默认模型后可停用。</p> : null}
        {confirmId === model.modelId ? <div className="record-confirm model-disable-confirm" role="group" aria-label="确认停用模型"><strong>停用「{label(model.name)}」？</strong><p>已完成结果保留。新分析不能选择此模型；未开始使用该模型的任务将报告停用原因，已开始使用的任务可以完成。</p><button className="danger-button" disabled={busy} onClick={() => { setConfirmId(null); void update(label(model.modelId), { enabled: false }) }}>确认停用</button><button className="clear-button" disabled={busy} onClick={() => setConfirmId(null)}>取消</button></div> : null}
        <details><summary>模型身份</summary><code>{label(model.modelId)}</code></details>
      </article>
    })}</div>
  </>
}
