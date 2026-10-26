import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../apiClient'
import { contractFailed, flag, record, recordList, riskNumber, text } from '../apiContract'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { ACTIVE_STATUSES, parseSync, STATUS_LABELS, type SyncView } from '../repositoryContract'
import { FailureNotice } from '../Feedback'
import type { PRSnapshot } from '../prReviewClient'
import type { Route } from '../navigation'

interface Analysis { sync: SyncView; contextValid: boolean; scores: { commitId: string; risk: number }[] }
export function PRModelClues({ source, navigate, modelId, onModelId }: { source: PRSnapshot; navigate: (route: Route) => void; modelId?: string; onModelId: (id: string) => void }) {
  const [models, setModels] = useState<ModelChoice[]>([]), [items, setItems] = useState<Analysis[]>([])
  const selection = useRef({ modelId, onModelId })
  useEffect(() => { selection.current = { modelId, onModelId } }, [modelId, onModelId])
  const selected = modelId ?? ''
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const path = `/api/v1/pr-snapshots/${encodeURIComponent(source.snapshotId)}/analyses`
  const accept = useCallback((raw: unknown, bind = false) => {
    const body = record(raw)
    if (body.snapshotId !== source.snapshotId) contractFailed('模型线索所属版本不一致')
    const analyses = recordList(body.analyses).map(item => ({ sync: parseSync(item.sync), contextValid: flag(item.contextValid),
      scores: recordList(item.scores).map(score => ({ commitId: text(score.commitId), risk: riskNumber(score.risk) })) }))
    setItems(analyses)
    const job = analyses[0]?.sync, bound = job?.requestedModelId ?? job?.resolvedModelId ?? job?.modelId
    if (bound && (bind || selection.current.modelId === undefined) && bound !== selection.current.modelId) selection.current.onModelId(bound)
  }, [source.snapshotId])
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(value => { if (!controller.signal.aborted) setModels(value) }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [source.snapshotId, attempt])
  useEffect(() => {
    const controller = new AbortController()
    apiRequest({ path, method: 'GET', signal: controller.signal }).then(raw => { if (!controller.signal.aborted) accept(raw) }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [path, attempt, accept])
  const running = items.some(item => (ACTIVE_STATUSES as readonly string[]).includes(item.sync.status))
  useEffect(() => { if (!running) return; const timer = setInterval(() => setAttempt(value => value + 1), 2000); return () => clearInterval(timer) }, [running])
  async function generate() {
    if (busy) return
    setBusy(true); setError(null)
    try { accept(await apiRequest({ path, method: 'POST', body: selected ? { modelId: selected } : {} }), true) }
    catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }
  return <details className="pr-model-clues"><summary>本版本的辅助模型线索</summary><p>模型按固定目标版本采集并对提交打分。分数未经本仓库概率校准，不是 PR 整体缺陷概率，也不提供行级定位。人工问题、阅读和草稿不依赖模型。</p>
    {error ? <FailureNotice error={error}/> : null}
    <label>模型<select aria-label="本版本分析模型" value={selected} onChange={e => onModelId(e.target.value)} disabled={busy || running}><option value="">使用管理员默认模型（任务创建时固定）</option>{selected && !models.some(model => model.modelId === selected) ? <option value={selected} disabled>已选择的原模型（当前不可用）</option> : null}{models.map(model => <option key={model.modelId} value={model.modelId} disabled={!model.repositoryPredictionSupported}>{model.name}{!model.repositoryPredictionSupported ? '（不可用）' : ''}</option>)}</select></label>
    <button className="clear-button" disabled={busy || running} onClick={() => void generate()}>{busy ? '正在提交…' : '生成本版本模型线索'}</button><button className="text-button" onClick={() => { setError(null); setAttempt(value => value + 1) }}>重新读取模型线索</button>
    {!items.length ? <p>此版本尚无模型分析；模型不可用时可以继续人工审查。</p> : items.map(item => <article key={item.sync.syncId}><strong>{STATUS_LABELS[item.sync.status]}</strong><p>模型 {item.sync.modelId ?? item.sync.resolvedModelId ?? item.sync.requestedModelId ?? '尚未绑定'} · 任务 {item.sync.syncId}</p>{item.sync.error ? <p className="field-error">{item.sync.error.message}</p> : null}{item.sync.status === 'completed' && !item.contextValid ? <p className="field-error">实际分析 HEAD 与当前 PR 版本不一致，未采用任何分数。</p> : null}{item.contextValid ? <><p>当前 PR 已加载提交中有 {item.scores.length}/{source.totalCommits} 条可核对分数；未覆盖条目不计为低风险。</p><ul>{item.scores.map(score => <li key={score.commitId}><code>{score.commitId.slice(0, 12)}</code> · {score.risk.toFixed(4)}</li>)}</ul><button className="text-button" onClick={() => { if (item.sync.repositoryId) navigate({ name: 'analysis', repositoryId: item.sync.repositoryId, viewSyncId: item.sync.syncId, view: 'commits' }) }}>打开固定分析与原模型解释</button></> : null}</article>)}
  </details>
}
