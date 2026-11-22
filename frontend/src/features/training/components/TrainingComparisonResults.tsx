import { Button } from '@/components/ui/button'
import { metricReason, metricValue, type Row, type TrainingExperimentComparison } from '@/features/admin/adminContracts'
import { formatMethodParams } from '@/lib/methodParams'
import { trainingStatus } from '@/features/training/trainingPresentation'

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
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
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

export function TrainingComparisonResults({ comparison, onExport }: {
  comparison: TrainingExperimentComparison
  onExport?: () => void
}) {
  return <section aria-label="训练实验比较" className="grid min-w-0 gap-3 rounded-xl border border-border-soft bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold">三档结果比较</h2>
        <p className="mt-1 text-xs text-foreground-3">{comparison.comparable ? '各方法使用相同数据与切分成员。' : '口径不一致，不可直接比较。'}</p>
      </div>
      {onExport ? <Button onClick={onExport} variant="outline" size="sm" type="button">导出比较</Button> : null}
    </div>
    {comparison.notes.map(note => <p key={note} className="text-xs text-foreground-3">{note}</p>)}
    <p className="text-xs leading-body text-foreground-3">
      训练档只用于拟合诊断，验证档是模型选择背景，测试档承担冻结泛化评价；不同分区不可合并成单一得分。
    </p>
    <div className="grid min-w-0 gap-3">
      {comparison.methods.map(row => <article key={row.taskId} className="grid min-w-0 gap-3 rounded-lg border border-border-soft p-3">
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
    </div>
    <p className="break-all font-mono text-[11px] text-foreground-4">
      {comparison.datasetVersion} · {comparison.splitPreset} · {comparison.metricSet} · manifest {comparison.manifestSha256}
    </p>
  </section>
}
