import { useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { metricReason, metricValue, type Row, type TrainingExperimentComparison } from '@/features/admin/adminContracts'
import { formatMethodParams } from '@/lib/methodParams'
import { cn } from '@/lib/utils'
import { trainingMethodName, trainingStatus } from '@/features/training/trainingPresentation'
import { thresholdCandidate, type ThresholdEvaluation, type ThresholdRequest } from '../trainingComparison'
import { TrainingThresholdComparison } from './TrainingThresholdComparison'

const PARTITIONS = [
  { key: 'train', label: '训练集', note: '用于拟合模型' },
  { key: 'validation', label: '验证集', note: '用于选择阈值' },
  { key: 'test', label: '测试集', note: '用于最终评估' },
] as const

type PartitionKey = typeof PARTITIONS[number]['key']

const TEST_METRICS = [
  ['averagePrecision', 'AP'],
  ['rocAuc', 'ROC-AUC'],
  ['f1', 'F1'],
  ['precision', '精确率'],
  ['recall', '召回率'],
  ['recall20Loc', 'Recall@20%LOC'],
] as const

const PARTITION_METRICS = [
  ['averagePrecision', 'AP'],
  ['rocAuc', 'ROC-AUC'],
  ['recall20Loc', 'Recall@20%LOC'],
  ['popt', 'Popt'],
  ['f1', 'F1'],
  ['ifa', 'IFA'],
] as const

function count(metrics: Row, key: 'records' | 'positive' | 'positives'): string {
  const counts = metrics['counts']
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return '—'
  const value = (counts as Row)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'
}

function positiveCount(metrics: Row): string {
  const value = count(metrics, 'positive')
  return value === '—' ? count(metrics, 'positives') : value
}

function rawNumber(metrics: Row | null | undefined, key: string): number | null {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function metricText(metrics: Row | null | undefined, key: string): string {
  const value = metricValue(metrics, key)
  return value === null ? '未定义' : value.toFixed(3)
}

export function TrainingPartitionMetrics({ metrics, only, title = '分区指标' }: {
  metrics: Row | null | undefined
  only?: readonly PartitionKey[]
  title?: string | null
}) {
  const partitions = only ? PARTITIONS.filter(partition => only.includes(partition.key)) : PARTITIONS
  return <section className="grid min-w-0 gap-2">
    {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
    <div className={cn('grid min-w-0 items-start gap-3',
      partitions.length >= 3 ? 'lg:grid-cols-3' : partitions.length === 2 ? 'lg:grid-cols-2' : null)}>
      {partitions.map(partition => {
        const value = metrics?.[partition.key]
        const part = value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null
        return <section key={partition.key} className="grid min-w-0 gap-2 rounded-lg border border-border-soft bg-card p-3">
          <header>
            <h3 className="text-sm font-semibold">{partition.label}</h3>
            <p className="text-xs text-foreground-3">{partition.note}</p>
          </header>
          {part ? <>
            <p className="text-xs text-foreground-3">记录 {count(part, 'records')} · 正例 {positiveCount(part)}</p>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-soft bg-border-soft">
              {PARTITION_METRICS.map(([key, label]) => {
                const current = metricValue(part, key)
                const reason = metricReason(part, key)
                return <div key={key} className="grid min-w-0 gap-0.5 bg-card p-2">
                  <dt className="text-[11px] text-foreground-3">{label}</dt>
                  <dd className="m-0 text-sm font-semibold tabular-nums" title={current === null && reason ? reason : undefined}>{current === null ? '未定义' : current.toFixed(3)}</dd>
                </div>
              })}
            </dl>
          </> : <p className="text-xs text-foreground-3">未记录该分区指标。</p>}
        </section>
      })}
    </div>
  </section>
}

export function TrainingComparisonResults({ comparison, onExport, onEvaluateThresholds }: {
  comparison: TrainingExperimentComparison
  onExport?: (evaluation?: ThresholdEvaluation) => void
  onEvaluateThresholds?: (request: ThresholdRequest, signal: AbortSignal) => Promise<ThresholdEvaluation>
}) {
  const [evaluation, setEvaluation] = useState<ThresholdEvaluation | null>(null)
  const methods = comparison.methods.map(method => ({ ...method, methodName: trainingMethodName(method.method, method.methodName) }))
  const candidates = methods.flatMap(method => thresholdCandidate(method) ?? [])
  const rows = methods.map(method => {
    const partitions = method.metricsByPartition as Row | null
    return { method, partitions, test: (partitions?.test ?? method.metrics ?? null) as Row | null }
  })
  const successful = rows.filter(row => row.method.status === 'succeeded')
  const verifiedSplit = comparison.comparable && successful.length >= 2 && successful.every(row => row.method.splitMemberSha256
    && row.method.splitMemberSha256 === successful[0].method.splitMemberSha256)
  const currentEvaluation = evaluation?.experimentId === comparison.experimentId && evaluation.methods.every(method =>
    candidates.some(({ method: candidate }) => candidate.taskId === method.taskId
      && candidate.artifactRunId === method.artifactRunId)) ? evaluation : null
  const counts = successful[0]?.test ?? null
  const threshold = rawNumber(counts, 'threshold')
  const best: Record<string, number | null> = {}
  for (const [key] of TEST_METRICS) {
    const values = successful.map(row => metricValue(row.test, key)).filter((value): value is number => value !== null)
    const top = values.length >= 2 && values.some(value => value !== values[0]) ? Math.max(...values) : null
    best[key] = top !== null && values.includes(top) ? top : null
  }
  return <section aria-label="训练实验比较" className="grid min-w-0 grid-cols-1 gap-4">
    <div className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">模型对比</h2>
          <p className={`mt-1 inline-flex rounded-md px-2 py-1 text-xs ${verifiedSplit ? 'bg-accent-soft text-accent' : 'bg-amber-soft text-amber-deep'}`}>{comparison.comparable
            ? verifiedSplit ? '各方法使用相同数据与切分成员' : '未核实切分成员一致'
            : '口径不一致，不可直接比较。'}</p>
        </div>
        {onExport ? <Button onClick={() => onExport(currentEvaluation ?? undefined)} variant="outline" size="sm" type="button">
          <Download aria-hidden="true"/>导出比较
        </Button> : null}
      </div>
      {comparison.notes.map(note => <p key={note} className="mt-2 px-4 text-xs text-foreground-3 sm:px-5">{note}</p>)}
      {successful.length ? <>
        <p className="px-4 pt-3 text-xs tabular-nums text-foreground-3 sm:px-5">
          测试集 {counts ? count(counts, 'records') : '—'} 条 · 正例 {counts ? positiveCount(counts) : '—'} 条
          {threshold === null ? '' : ` · F1 / 精确率 / 召回率按阈值 ${threshold.toFixed(2)}`}
        </p>
        <div className="mt-2 overflow-x-auto border-t border-border-soft">
          <table aria-label="模型性能对比" className="w-full min-w-[46rem] text-left text-sm tabular-nums [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 sm:[&_:is(th,td):first-child]:pl-5 sm:[&_:is(th,td):last-child]:pr-5">
            <thead className="bg-sunken text-xs text-foreground-3"><tr>
              <th scope="col">模型</th>
              {TEST_METRICS.map(([key, label]) => <th key={key} scope="col" className="whitespace-nowrap text-right">{label}</th>)}
            </tr></thead>
            <tbody>{successful.map(row => <tr key={row.method.taskId} className="border-t border-border-soft">
              <th scope="row" className="min-w-28 whitespace-nowrap font-medium">{row.method.methodName}</th>
              {TEST_METRICS.map(([key]) => {
                const value = metricValue(row.test, key)
                const reason = metricReason(row.test, key)
                const top = best[key]
                const isBest = top !== null && value !== null && value === top
                return <td key={key} className="align-top">
                  <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                    <span className={cn('font-mono font-semibold', isBest && 'text-accent')}>{value === null ? '未定义' : value.toFixed(3)}</span>
                    {isBest ? <span className="rounded-sm bg-accent-soft px-1 text-[11px] font-medium text-accent">最高</span> : null}
                  </div>
                  {value === null && reason ? <p className="mt-1 max-w-[14rem] text-right text-xs font-normal text-foreground-3 [overflow-wrap:anywhere]">{reason}</p> : null}
                </td>
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <details className="group border-t border-border-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-foreground-2 sm:px-5 [&::-webkit-details-marker]:hidden">
            训练集与验证集指标 <ChevronDown aria-hidden="true" className="size-3.5 text-foreground-3 group-open:rotate-180"/>
          </summary>
          <div className="grid min-w-0 gap-3 px-4 pb-4 sm:px-5">
            {successful.map(row => row.partitions
              ? <article key={row.method.taskId} className="grid min-w-0 gap-2">
                <h3 className="text-xs font-semibold">{row.method.methodName}</h3>
                <TrainingPartitionMetrics metrics={row.partitions} only={['train', 'validation']} title={null}/>
              </article>
              : <p key={row.method.taskId} className="text-xs text-foreground-3">{row.method.methodName} 未记录训练集与验证集指标。</p>)}
          </div>
        </details>
      </> : <p className="px-4 pb-4 pt-2 text-sm text-foreground-3 sm:px-5">暂无成功模型。</p>}
    </div>
    {onEvaluateThresholds && successful.length >= 2 ? candidates.length >= 2 ? <details className="group min-w-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          阈值调整评估
          <span className="text-xs font-normal text-foreground-3">在验证集选阈值，用测试集复核</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-foreground-3 group-open:rotate-180"/>
      </summary>
      <div className="mt-3 min-w-0"><TrainingThresholdComparison
        key={candidates.map(({ method }) => method.taskId).join(',')}
        candidates={candidates} result={currentEvaluation} onResult={setEvaluation} onEvaluate={onEvaluateThresholds}/></div>
    </details>
      : <p className="text-sm text-foreground-3">至少两个模型保存了验证集阈值数据后，才能调整阈值。</p> : null}
    <details className="group min-w-0 rounded-xl border border-border-soft bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
        模型参数与训练详情 <ChevronDown className="size-4 text-foreground-3 group-open:rotate-180" aria-hidden="true"/>
      </summary>
      <div className="grid min-w-0 gap-3 border-t border-border-soft px-4 py-4 sm:px-5">
        {rows.map(row => <article key={row.method.taskId} className="grid min-w-0 gap-2 rounded-lg border border-border-soft p-3">
          <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{row.method.methodName}</h3>
            <span className="text-xs text-foreground-3">{trainingStatus[row.method.status]?.label ?? row.method.status}</span>
            <span className="text-xs text-foreground-3">{formatMethodParams(row.method.parameters)}</span>
            <span className="text-xs text-foreground-3">耗时 {row.method.trainingSeconds == null ? '未记录' : `${row.method.trainingSeconds.toFixed(2)}s`}</span>
          </header>
          {row.method.error ? <p className="text-xs text-rose" role="status">{row.method.error.code} · {row.method.error.message}</p> : null}
          {row.method.status === 'succeeded' ? <p className="text-xs tabular-nums text-foreground-3">
            工作量指标：Popt <span title={metricReason(row.test, 'popt') ?? undefined}>{metricText(row.test, 'popt')}</span>
            {' '}· IFA <span title={metricReason(row.test, 'ifa') ?? undefined}>{metricText(row.test, 'ifa')}</span>
          </p> : null}
        </article>)}
        <p className="break-all font-mono text-[11px] text-foreground-4">
          {comparison.datasetVersion} · {comparison.splitPreset} · {comparison.metricSet} · manifest {comparison.manifestSha256}
        </p>
      </div>
    </details>
  </section>
}
