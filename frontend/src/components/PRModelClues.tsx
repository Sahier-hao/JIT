import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/controls'
import { apiRequest } from '../apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, riskNumber, text, textList } from '../apiContract'
import { repositoryModels, type ModelChoice } from '../modelClient'
import { ACTIVE_STATUSES, parseSync, STATUS_LABELS, type SyncView } from '../repositoryContract'
import { cancelRepositorySync } from '../projectClient'
import { FailureNotice } from '../Feedback'
import type { PRSnapshot } from '../prReviewClient'
import type { Route } from '../navigation'

type BindingKind = 'snapshot-model-v1' | 'legacy-head-v1'
interface Analysis { sync: SyncView; contextValid: boolean; scores: { commitId: string; risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }[]; fileRisks: { path: string; risk: number }[]; bindingKind?: BindingKind; bindingLimitations: string[]; coverageComplete?: boolean; scoredCommits?: number; totalCommits?: number }

function originLabel(job: SyncView) {
  return job.origin === 'auto' || job.origin === 'automatic' || job.origin === 'pr-tracking' ? '项目自动分析' : job.origin === 'manual' ? '手动分析' : '已保存分析（来源未标注）'
}

export function PRModelClues({ source, navigate, modelId, onModelId, readOnly = false, onFileRisks, onCommitRisks }: { source: PRSnapshot; navigate: (route: Route) => void; modelId?: string; onModelId: (id: string) => void; readOnly?: boolean; onFileRisks?: (risks: Record<string, number>) => void; onCommitRisks?: (risks: Record<string, { risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }>) => void }) {
  const [models, setModels] = useState<ModelChoice[]>([]), [items, setItems] = useState<Analysis[]>([])
  const selection = useRef({ modelId, onModelId })
  useEffect(() => { selection.current = { modelId, onModelId } }, [modelId, onModelId])
  const [localModel, setLocalModel] = useState('')
  const selected = readOnly ? localModel : (modelId ?? '')
  const chooseModel = readOnly ? setLocalModel : onModelId
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0), [cancelling, setCancelling] = useState<SyncView | null>(null), [expanded, setExpanded] = useState(false)
  const path = `/api/v1/pr-snapshots/${encodeURIComponent(source.snapshotId)}/analyses`
  const accept = useCallback((raw: unknown, bind = false) => {
    const body = record(raw)
    if (body.snapshotId !== source.snapshotId) contractFailed('模型线索所属版本不一致')
    const analyses: Analysis[] = recordList(body.analyses).map(item => {
      const bindingKind = item.bindingKind === undefined ? undefined : text(item.bindingKind)
      if (bindingKind && bindingKind !== 'snapshot-model-v1' && bindingKind !== 'legacy-head-v1') contractFailed('模型分析绑定口径无法识别')
      return { sync: parseSync(item.sync), contextValid: flag(item.contextValid), bindingKind: bindingKind as BindingKind | undefined,
        bindingLimitations: item.bindingLimitations === undefined ? [] : textList(item.bindingLimitations),
        coverageComplete: item.coverageComplete === undefined ? undefined : flag(item.coverageComplete),
        scoredCommits: item.scoredCommits === undefined ? undefined : finiteNumber(item.scoredCommits),
        totalCommits: item.totalCommits === undefined ? undefined : finiteNumber(item.totalCommits),
        fileRisks: item.fileRisks === undefined ? [] : recordList(item.fileRisks).map(file => ({ path: text(file.path), risk: riskNumber(file.risk) })),
        scores: recordList(item.scores).map(score => ({ commitId: text(score.commitId), risk: riskNumber(score.risk), files: score.files === undefined ? [] : textList(score.files), addedLines: score.addedLines === undefined ? undefined : finiteNumber(score.addedLines), deletedLines: score.deletedLines === undefined ? undefined : finiteNumber(score.deletedLines), fileCount: score.fileCount === undefined ? undefined : finiteNumber(score.fileCount) })) }
    })
    if (analyses.some(a => a.sync.sourceSnapshotId && a.sync.sourceSnapshotId !== source.snapshotId)) contractFailed('分析与固定快照不一致')
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
  // 风险概览只取一条已完成且来源有效的分析；没有就如实说明，不把未分析当作低风险。
  const primary = items.find(item => item.contextValid && item.sync.status === 'completed' && item.scores.length)
  const topRisk = primary ? Math.max(...primary.scores.map(score => score.risk)) : null
  const coverage = primary ? `${primary.scoredCommits ?? primary.scores.length}/${primary.totalCommits ?? source.totalCommits}` : null
  const fileRiskMap = useMemo(() => Object.fromEntries((primary?.fileRisks ?? []).map(item => [item.path, item.risk])), [primary])
  const commitRiskMap = useMemo(() => Object.fromEntries((primary?.scores ?? []).map(score => [score.commitId, { risk: score.risk, files: score.files, addedLines: score.addedLines, deletedLines: score.deletedLines, fileCount: score.fileCount }])), [primary])
  useEffect(() => { onFileRisks?.(fileRiskMap) }, [fileRiskMap, onFileRisks])
  useEffect(() => { onCommitRisks?.(commitRiskMap) }, [commitRiskMap, onCommitRisks])
  useEffect(() => { if (!running) return; const timer = setInterval(() => setAttempt(value => value + 1), 2000); return () => clearInterval(timer) }, [running])
  async function generate(job?: SyncView) {
    if (busy) return
    setBusy(true); setError(null)
    const bound = job ? job.requestedModelId ?? job.resolvedModelId ?? job.modelId : selected
    try {
      if (job && !bound) contractFailed('原任务没有可追溯的固定模型，请明确选择模型生成新的分析')
      accept(await apiRequest({ path, method: 'POST', body: { ...(bound ? { modelId: bound } : {}), ...(job ? { retry: true } : {}) } }), true)
    } catch (failure) { setError(failure) } finally { setBusy(false) }
  }
  async function cancel() {
    if (busy || !cancelling) return
    setBusy(true); setError(null)
    try { await cancelRepositorySync(cancelling.syncId); setCancelling(null); setAttempt(v => v + 1) } catch (failure) { setError(failure) } finally { setBusy(false) }
  }
  const compatible = (m: ModelChoice) => m.state === 'ready' && m.enabled && m.repositoryPredictionSupported
  const invalid = Boolean(selected && !models.some(m => m.modelId === selected && compatible(m)))
  return <details className="pr-model-clues" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary title="按提交分数排序；不是 PR 整体缺陷概率，也不提供行级定位"><span>风险概览</span><span className="pr-clue-summary">{topRisk === null ? (running ? '分析中' : '尚无分数 · 点开查看模型线索') : `最高 ${topRisk.toFixed(3)} · ${coverage} 有分数`}</span></summary>
    {error ? <FailureNotice error={error}/> : null}
    <>
      {readOnly ? <p className="form-hint">只读预览；生成会创建该版本的项目级固定分析，不写入个人草稿。开始审查后可在工作单继续人工判断。</p> : null}
      <label>模型<select aria-label="本版本分析模型" value={selected} onChange={e => chooseModel(e.target.value)} disabled={busy || running}><option value="">使用管理员默认模型（任务创建时固定）</option>{selected && !models.some(model => model.modelId === selected) ? <option value={selected} disabled>已选择的原模型（当前不可用）</option> : null}{models.map(model => <option key={model.modelId} value={model.modelId} disabled={!compatible(model)}>{model.name}{!compatible(model) ? '（不可用）' : ''}</option>)}</select></label>
      {invalid ? <p className="field-error">原选模型不可用，未自动替换。请明确选择兼容模型。</p> : null}
      <Button size="sm" loading={busy} disabled={running || invalid} onClick={() => void generate()}>{busy ? '正在提交…' : '生成本版本模型线索'}</Button>
    </>
    <Button variant="link" size="sm" onClick={() => { setError(null); setAttempt(value => value + 1) }}>重新读取模型线索</Button>
    {!items.length ? <p>此版本尚无模型分析；模型不可用时可以继续人工审查。</p> : items.map(item => <article key={item.sync.syncId}><strong>{STATUS_LABELS[item.sync.status]}</strong><p>{originLabel(item.sync)} · 模型 {item.sync.modelId ?? item.sync.resolvedModelId ?? item.sync.requestedModelId ?? '尚未绑定'} · 任务 {item.sync.syncId}</p>{item.bindingKind === 'legacy-head-v1' ? <div className="status-note"><strong>旧版 HEAD 绑定分析</strong><p>可读取实际固定 HEAD 与已保存评分；不能据此认定具有新版任务的独占基准版本、提交前模型绑定。</p>{item.bindingLimitations.length ? <ul>{item.bindingLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}</div> : null}{item.sync.error ? <p className="field-error">{item.sync.error.message}</p> : null}{item.sync.status === 'completed' && !item.contextValid ? <p className="field-error">实际分析 HEAD 与当前 PR 版本不一致，未采用任何分数。</p> : null}{item.contextValid ? <><p>{item.scoredCommits ?? item.scores.length}/{item.totalCommits ?? source.totalCommits} 有分数</p><ol className="pr-clue-ranking">{ [...item.scores].sort((a, b) => b.risk - a.risk).slice(0, 10).map(score => { const message = source.commits.find(commit => commit.sha === score.commitId)?.message.split('\n')[0] ?? ''; return <li key={score.commitId}><code>{score.commitId.slice(0, 12)}</code><span className="pr-clue-message" title={message}>{message || '提交标题未加载'}</span><strong>{score.risk.toFixed(4)}</strong></li> })}</ol>{item.scores.length > 10 ? <p className="form-hint">其余 {item.scores.length - 10} 条在固定分析中查看</p> : null}<Button variant="link" size="sm" onClick={() => { if (item.sync.repositoryId) navigate({ name: 'analysis', repositoryId: item.sync.repositoryId, viewSyncId: item.sync.syncId, view: 'commits' }) }}>打开固定分析</Button></> : null}{!readOnly && ['failed', 'cancelled', 'interrupted'].includes(item.sync.status) ? <Button size="sm" disabled={busy} onClick={() => void generate(item.sync)}>用原模型主动重试</Button> : null}{!readOnly && (ACTIVE_STATUSES as readonly string[]).includes(item.sync.status) ? <Button size="sm" disabled={busy || Boolean(item.sync.cancelRequestedAt)} onClick={() => setCancelling(item.sync)}>{item.sync.cancelRequestedAt ? '正在取消…' : '取消本次模型分析'}</Button> : null}</article>)}
    {cancelling ? <div role="alertdialog" aria-label="确认取消 PR 模型分析"><p>取消此固定模型任务，不关闭项目跟踪，也不删除个人草稿。同一分析意图不会因轮询自动复活。</p><Button size="sm" disabled={busy} onClick={() => void cancel()}>确认取消模型分析</Button><Button size="sm" disabled={busy} onClick={() => setCancelling(null)}>继续分析</Button></div> : null}
  </details>
}
