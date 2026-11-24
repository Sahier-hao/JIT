import { useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { metricReason, metricValue, type Row, type TrainingExperimentComparison } from '@/features/admin/adminContracts'
import { formatMethodParams } from '@/lib/methodParams'
import { trainingMethodName, trainingStatus } from '@/features/training/trainingPresentation'
import { thresholdCandidate, type ThresholdEvaluation, type ThresholdRequest } from '../trainingComparison'
import { TrainingThresholdComparison } from './TrainingThresholdComparison'

const PARTITIONS = [
  { key: 'train', label: '训练档', note: '拟合诊断' },
  { key: 'validation', label: '验证档', note: '模型选择背景' },
  { key: 'test', label: '测试档', note: '冻结泛化评价' },
] as const

const METRICS = [
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

export function TrainingPartitionMetrics({ metrics }: { metrics: Row | null | undefined }) {
  return <section className="grid min-w-0 gap-2">
    <h2 className="text-sm font-semibold">分区指标</h2>
    <div className="grid min-w-0 items-start gap-3 lg:grid-cols-3">
      {PARTITIONS.map(partition => {
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
              {METRICS.map(([key, label]) => {
                const current = metricValue(part, key)
                const reason = metricReason(part, key)
                return <div key={key} className="grid min-w-0 gap-0.5 bg-card p-2">
                  <dt className="text-[11px] text-foreground-3">{label}</dt>
                  <dd className="m-0 text-sm font-semibold tabular-nums">{current === null ? '未定义' : current.toFixed(3)}</dd>
                  {current === null && reason ? <dd className="m-0 text-[11px] leading-snug text-foreground-4">{reason}</dd> : null}
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
  const [partition, setPartition] = useState<typeof PARTITIONS[number]['key']>('test')
  const [selectedMetric, setMetric] = useState<string>('averagePrecision')
  const [evaluation, setEvaluation] = useState<ThresholdEvaluation | null>(null)
  const metrics = [...METRICS, ['precision', '精确率'], ['recall', '召回率']] as const
  const metricLabel = metrics.find(([key]) => key === selectedMetric)?.[1]
  const methods = comparison.methods.map(method => ({ ...method, methodName: trainingMethodName(method.method, method.methodName) }))
  const candidates = methods.flatMap(method => thresholdCandidate(method) ?? [])
  const successful = methods.filter(method => method.status === 'succeeded')
  const verifiedSplit = comparison.comparable && successful.length >= 2 && successful.every(method => method.splitMemberSha256
    && method.splitMemberSha256 === successful[0].splitMemberSha256)
  const thresholdMetric = ['precision', 'recall', 'f1'].includes(selectedMetric)
  const currentEvaluation = evaluation?.experimentId === comparison.experimentId && evaluation.methods.every(method =>
    candidates.some(({ method: candidate }) => candidate.taskId === method.taskId
      && candidate.artifactRunId === method.artifactRunId)) ? evaluation : null
  return <section aria-label="训练实验比较" className="grid min-w-0 grid-cols-1 gap-4">
    <div className="min-w-0 overflow-hidden rounded-xl border border-border-soft bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">三档结果比较</h2>
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
          <ToggleGroup aria-label="数据分区" type="single" size="sm" variant="outline" value={partition}
            onValueChange={value => { if (value) setPartition(value as typeof partition) }}>
            {PARTITIONS.map(part => <ToggleGroupItem key={part.key} value={part.key}>{part.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <label className="flex items-center gap-2 text-xs whitespace-nowrap text-foreground-3">性能指标
            <NativeSelect size="sm" value={selectedMetric} onChange={event => setMetric(event.currentTarget.value)}>
              {metrics.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </NativeSelect>
          </label>
        </div>
        <div className="overflow-x-auto border-t border-border-soft">
          <table aria-label="模型性能对比" className="w-full text-left text-sm tabular-nums [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 sm:[&_:is(th,td):first-child]:pl-5 sm:[&_:is(th,td):last-child]:pr-5">
            <thead className="bg-sunken text-xs text-foreground-3"><tr>
              <th scope="col">模型</th><th scope="col">样本</th><th scope="col">正例</th>
              <th scope="col" className="w-1/3 whitespace-nowrap text-right">{metricLabel}{thresholdMetric ? '（0.50）' : null}</th>
            </tr></thead>
            <tbody>{successful.map(method => {
              const values = method.metricsByPartition?.[partition] ?? (partition === 'test' ? method.metrics : null)
              const results = (values ?? {}) as Row
              const value = metricValue(results, selectedMetric)
              const reason = metricReason(results, selectedMetric)
              return <tr key={method.taskId} className="border-t border-border-soft">
                <th scope="row" className="min-w-24 font-medium [overflow-wrap:anywhere]">{method.methodName}</th>
                <td className="text-foreground-3">{count(results, 'records')}</td><td className="text-foreground-3">{positiveCount(results)}</td>
                <td>
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    {verifiedSplit && value !== null && selectedMetric !== 'ifa' && value >= 0 && value <= 1
                      ? <span aria-hidden="true" className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-sunken lg:block">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${value * 100}%` }}/>
                      </span> : null}
                    <span className="font-mono font-semibold">{value === null ? '未定义' : value.toFixed(3)}</span>
                  </div>
                  {value === null && reason ? <p className="mt-1 text-right text-xs text-foreground-3 [overflow-wrap:anywhere]">{reason}</p> : null}
                </td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </> : <p className="px-4 pb-4 pt-2 text-sm text-foreground-3 sm:px-5">暂无成功模型。</p>}
    </div>
    {onEvaluateThresholds && successful.length >= 2 ? candidates.length >= 2 ? <TrainingThresholdComparison
      key={candidates.map(({ method }) => method.taskId).join(',')}
      candidates={candidates} result={currentEvaluation} onResult={setEvaluation} onEvaluate={onEvaluateThresholds}/>
      : <p className="text-sm text-foreground-3">至少两个模型保存了验证集阈值数据后，才能进行阈值对比。</p> : null}
    <details className="group min-w-0 rounded-xl border border-border-soft bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
        模型训练详情 <ChevronDown className="size-4 text-foreground-3 group-open:rotate-180" aria-hidden="true"/>
      </summary>
      <div className="grid min-w-0 gap-3 border-t border-border-soft px-4 py-4 sm:px-5">
        <p className="text-xs leading-body text-foreground-3">训练档用于拟合诊断，验证档用于选择模型和阈值，测试档用于检验泛化表现。</p>
        {methods.map(row => <article key={row.taskId} className="grid min-w-0 gap-3 rounded-lg border border-border-soft p-3">
        <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{row.methodName}</h3>
          <span className="text-xs text-foreground-3">{trainingStatus[row.status].label}</span>
          <span className="text-xs text-foreground-3">{formatMethodParams(row.parameters)}</span>
          <span className="text-xs text-foreground-3">耗时 {row.trainingSeconds == null ? '未记录' : `${row.trainingSeconds.toFixed(2)}s`}</span>
        </header>
        {row.error ? <p className="text-xs text-rose" role="status">{row.error.code} · {row.error.message}</p> : null}
        {row.status === 'succeeded' ? row.metricsByPartition
          ? <TrainingPartitionMetrics metrics={row.metricsByPartition}/>
          : <p className="text-xs text-foreground-3">仅记录测试档摘要；训练与验证分区未记录。</p>
          : null}
        </article>)}
        <p className="break-all font-mono text-[11px] text-foreground-4">
          {comparison.datasetVersion} · {comparison.splitPreset} · {comparison.metricSet} · manifest {comparison.manifestSha256}
        </p>
      </div>
    </details>
  </section>
}
