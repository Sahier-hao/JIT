import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from './apiClient'
import { contractFailed, finiteNumber, flag, record, recordList, riskNumber, text, textList } from './apiContract'
import { ACTIVE_STATUSES, parseSync, type SyncView } from './repositoryContract'
import { repositoryModels } from './modelClient'

export type BindingKind = 'snapshot-model-v1' | 'legacy-head-v1'
export interface CommitRisk { risk: number; files: string[]; addedLines?: number; deletedLines?: number; fileCount?: number }
export interface SnapshotAnalysis {
  sync: SyncView
  contextValid: boolean
  scores: ({ commitId: string } & CommitRisk)[]
  fileRisks: { path: string; risk: number }[]
  bindingKind?: BindingKind
  bindingLimitations: string[]
  coverageComplete?: boolean
  scoredCommits?: number
  totalCommits?: number
}

/** 只读详情与工作单共用的快照分析视图：一次读取，按提交派生风险映射。 */
export interface SnapshotAnalyses {
  analyses: SnapshotAnalysis[]
  primary: SnapshotAnalysis | null
  topRisk: number | null
  coverage: string | null
  running: boolean
  fileRisks: Record<string, number>
  commitRisks: Record<string, CommitRisk>
  modelName: string | null
  loading: boolean
  error: unknown
  retry: () => void
}

function isRunning(items: SnapshotAnalysis[] | undefined): boolean {
  return Boolean(items?.some(item => (ACTIVE_STATUSES as readonly string[]).includes(item.sync.status)))
}

export function parseSnapshotAnalyses(raw: unknown, snapshotId: string): SnapshotAnalysis[] {
  const body = record(raw)
  if (body.snapshotId !== snapshotId) contractFailed('模型线索所属版本不一致')
  const analyses = recordList(body.analyses).map(item => {
    const bindingKind = item.bindingKind === undefined ? undefined : text(item.bindingKind)
    if (bindingKind && bindingKind !== 'snapshot-model-v1' && bindingKind !== 'legacy-head-v1') contractFailed('模型分析绑定口径无法识别')
    return {
      sync: parseSync(item.sync),
      contextValid: flag(item.contextValid),
      bindingKind: bindingKind as BindingKind | undefined,
      bindingLimitations: item.bindingLimitations === undefined ? [] : textList(item.bindingLimitations),
      coverageComplete: item.coverageComplete === undefined ? undefined : flag(item.coverageComplete),
      scoredCommits: item.scoredCommits === undefined ? undefined : finiteNumber(item.scoredCommits),
      totalCommits: item.totalCommits === undefined ? undefined : finiteNumber(item.totalCommits),
      fileRisks: item.fileRisks === undefined ? [] : recordList(item.fileRisks).map(file => ({ path: text(file.path), risk: riskNumber(file.risk) })),
      scores: recordList(item.scores).map(score => ({
        commitId: text(score.commitId),
        risk: riskNumber(score.risk),
        files: score.files === undefined ? [] : textList(score.files),
        addedLines: score.addedLines === undefined ? undefined : finiteNumber(score.addedLines),
        deletedLines: score.deletedLines === undefined ? undefined : finiteNumber(score.deletedLines),
        fileCount: score.fileCount === undefined ? undefined : finiteNumber(score.fileCount),
      })),
    }
  })
  if (analyses.some(item => item.sync.sourceSnapshotId && item.sync.sourceSnapshotId !== snapshotId)) contractFailed('分析与固定快照不一致')
  return analyses
}

export function useSnapshotAnalyses(snapshotId: string, fallbackTotalCommits = 0): SnapshotAnalyses {
  const analysesQuery = useQuery({
    queryKey: ['pr-snapshot-analyses', snapshotId],
    queryFn: async ({ signal }) => parseSnapshotAnalyses(
      await apiRequest({ path: `/api/v1/pr-snapshots/${encodeURIComponent(snapshotId)}/analyses`, method: 'GET', signal }),
      snapshotId,
    ),
    enabled: snapshotId !== '',
    refetchInterval: query => (isRunning(query.state.data) ? 2000 : false),
  })
  const modelsQuery = useQuery({
    queryKey: ['repository-models'],
    queryFn: ({ signal }) => repositoryModels(signal),
    staleTime: 60_000,
  })
  const analyses = analysesQuery.data ?? []
  // 只取一条已完成且来源有效的分析；没有就如实说明，不把未分析当作低风险。
  const primary = analyses.find(item => item.contextValid && item.sync.status === 'completed' && item.scores.length) ?? null
  const topRisk = primary ? Math.max(...primary.scores.map(score => score.risk)) : null
  const coverage = primary ? `${primary.scoredCommits ?? primary.scores.length}/${primary.totalCommits ?? fallbackTotalCommits}` : null
  const fileRisks = useMemo(() => Object.fromEntries((primary?.fileRisks ?? []).map(item => [item.path, item.risk])), [primary])
  const commitRisks = useMemo(() => Object.fromEntries((primary?.scores ?? []).map(score => {
    const { commitId, ...risk } = score
    return [commitId, risk]
  })), [primary])
  const modelId = primary?.sync.modelId ?? primary?.sync.resolvedModelId ?? primary?.sync.requestedModelId ?? null
  const modelName = modelId ? modelsQuery.data?.find(model => model.modelId === modelId)?.name ?? null : null
  const retry = useCallback(() => { void analysesQuery.refetch() }, [analysesQuery])
  return {
    analyses,
    primary,
    topRisk,
    coverage,
    running: isRunning(analyses),
    fileRisks,
    commitRisks,
    modelName,
    loading: analysesQuery.isPending,
    error: analysesQuery.error,
    retry,
  }
}
