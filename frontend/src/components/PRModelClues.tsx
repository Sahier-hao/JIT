import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, riskNumber, text, textList } from '../apiContract'
import { ACTIVE_STATUSES, parseSync, type SyncView } from '../repositoryContract'
import { repositoryModels } from '../modelClient'
import { FailureNotice } from '../Feedback'
import type { PRSnapshot } from '../prReviewClient'
import type { Route } from '../navigation'

type BindingKind = 'snapshot-model-v1' | 'legacy-head-v1'
interface Analysis { sync: SyncView; contextValid: boolean; scores: { commitId: string; risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }[]; fileRisks: { path: string; risk: number }[]; bindingKind?: BindingKind; bindingLimitations: string[]; coverageComplete?: boolean; scoredCommits?: number; totalCommits?: number }

/** 风险概览：一行摘要 + 打开固定分析；详细排序在提交表与固定分析里。 */
export function PRModelClues({ source, navigate, onFileRisks, onCommitRisks }: { source: PRSnapshot; navigate: (route: Route) => void; onFileRisks?: (risks: Record<string, number>) => void; onCommitRisks?: (risks: Record<string, { risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }>) => void }) {
  const [items, setItems] = useState<Analysis[]>([])
  const [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0)
  const [names, setNames] = useState<Record<string, string>>({})
  const path = `/api/v1/pr-snapshots/${encodeURIComponent(source.snapshotId)}/analyses`
  const accept = useCallback((raw: unknown) => {
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
  }, [source.snapshotId])
  useEffect(() => {
    const controller = new AbortController()
    apiRequest({ path, method: 'GET', signal: controller.signal }).then(raw => { if (!controller.signal.aborted) accept(raw) }).catch(failure => { if (!controller.signal.aborted) setError(failure) })
    return () => controller.abort()
  }, [path, attempt, accept])
  useEffect(() => {
    const controller = new AbortController()
    repositoryModels(controller.signal).then(list => { if (!controller.signal.aborted) setNames(Object.fromEntries(list.map(model => [model.modelId, model.name]))) }).catch(() => undefined)
    return () => controller.abort()
  }, [])
  const running = items.some(item => (ACTIVE_STATUSES as readonly string[]).includes(item.sync.status))
  // 只取一条已完成且来源有效的分析；没有就如实说明，不把未分析当作低风险。
  const primary = items.find(item => item.contextValid && item.sync.status === 'completed' && item.scores.length)
  const topRisk = primary ? Math.max(...primary.scores.map(score => score.risk)) : null
  const coverage = primary ? `${primary.scoredCommits ?? primary.scores.length}/${primary.totalCommits ?? source.totalCommits}` : null
  const fileRiskMap = useMemo(() => Object.fromEntries((primary?.fileRisks ?? []).map(item => [item.path, item.risk])), [primary])
  const commitRiskMap = useMemo(() => Object.fromEntries((primary?.scores ?? []).map(score => [score.commitId, { risk: score.risk, files: score.files, addedLines: score.addedLines, deletedLines: score.deletedLines, fileCount: score.fileCount }])), [primary])
  useEffect(() => { onFileRisks?.(fileRiskMap) }, [fileRiskMap, onFileRisks])
  useEffect(() => { onCommitRisks?.(commitRiskMap) }, [commitRiskMap, onCommitRisks])
  useEffect(() => { if (!running) return; const timer = setInterval(() => setAttempt(value => value + 1), 2000); return () => clearInterval(timer) }, [running])
  const modelId = primary?.sync.modelId ?? primary?.sync.resolvedModelId ?? primary?.sync.requestedModelId ?? null
  const modelName = modelId ? names[modelId] ?? null : null
  return <div className="pr-risk-line" data-state={primary ? 'ready' : running ? 'running' : 'empty'}>
    <span className="pr-risk-label">模型分数</span>
    <span className="pr-risk-value">{primary ? `${coverage} 有分数 · 最高 ${topRisk!.toFixed(3)}` : running ? '分析中' : '尚无分数'}</span>
    {modelName ? <span className="pr-risk-model">{modelName}</span> : null}
    {primary?.sync.repositoryId ? <button type="button" className="pr-risk-link" onClick={() => navigate({ name: 'analysis', repositoryId: primary.sync.repositoryId!, viewSyncId: primary.sync.syncId, view: 'commits' })}>打开分析</button> : null}
    {error ? <span className="pr-risk-error" role="alert"><FailureNotice error={error}/></span> : null}
    {primary?.bindingKind === 'legacy-head-v1' ? <details className="pr-risk-legacy">
      <summary>旧版 HEAD 绑定</summary>
      <p>可读取实际固定 HEAD 与已保存评分；不能据此认定具有新版任务的独占基准版本、提交前模型绑定。</p>
      {primary.bindingLimitations.length ? <ul>{primary.bindingLimitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
    </details> : null}
  </div>
}
