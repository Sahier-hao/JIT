import type { Row } from '@/features/admin/adminContracts'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from './components/ui/table'

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const metric = record(value)
  return typeof metric.value === 'number' && Number.isFinite(metric.value)
    ? metric.value
    : null
}

function textValue(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

export function releaseWorstProject(rawReport: unknown) {
  const report = record(rawReport)
  const projects = Array.isArray(report.projects) ? report.projects : []
  const evaluated = projects.map(raw => {
    const project = record(raw)
    const metrics = record(project.metrics)
    return {
      project: textValue(project.project, '项目未记录'),
      ap: numberValue(metrics.averagePrecision),
      auc: numberValue(metrics.rocAuc),
    }
  }).filter(item => item.ap !== null) as Array<{ project: string; ap: number; auc: number | null }>
  if (!evaluated.length) return null
  return evaluated.reduce((worst, item) => item.ap < worst.ap ? item : worst)
}

export function releaseEffortDeltas(rawReport: unknown) {
  const report = record(rawReport)
  const assessment = record(report.assessment)
  const macro = record(assessment.macro ?? report.macro)
  const metrics = record(macro.metrics)
  const baselines = record(macro.baselines)
  return (['recall20Loc', 'popt'] as const).flatMap(metric => {
    const value = numberValue(metrics[metric])
    const baseline = record(baselines[metric])
    const time = numberValue(baseline.time)
    const random = numberValue(baseline.random)
    return value === null || time === null || random === null
      ? []
      : [{ metric, value, time, random, timeDelta: value - time, randomDelta: value - random }]
  })
}

export function ReleaseEvidence({ report }: { report: Row | null }) {
  if (!report) return <section className="grid gap-2"><h2 className="text-base font-semibold text-foreground">发布门槛</h2><p className="text-xs text-foreground-3">发布报告尚未生成</p></section>
  const assessment = record(report.assessment)
  const gates = Array.isArray(assessment.gates) ? assessment.gates.map(record) : []
  const worst = releaseWorstProject(report)
  const effort = releaseEffortDeltas(report)
  return <section className="grid gap-2">
    <h2 className="text-base font-semibold text-foreground">发布门槛</h2>
    <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
      <div><dt>最差项目 AP</dt><dd>{worst ? `${worst.project} · ${worst.ap.toFixed(4)}${worst.auc === null ? '' : ` · ROC-AUC ${worst.auc.toFixed(4)}`}` : '无已定义项目'}</dd></div>
    </dl>
    {effort.length ? <div className="overflow-x-auto rounded-sm border border-border-soft"><Table className="w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
      <TableHeader><TableRow><TableHead>跨项目指标</TableHead><TableHead>模型</TableHead><TableHead>较时间顺序</TableHead><TableHead>较随机均值</TableHead></TableRow></TableHeader>
      <TableBody>{effort.map(item => <TableRow key={item.metric}>
        <TableHead>{item.metric}</TableHead>
        <TableCell>{item.value.toFixed(4)}</TableCell>
        <TableCell>{signed(item.timeDelta)}</TableCell>
        <TableCell>{signed(item.randomDelta)}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : null}
    <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">{gates.map((gate, index) =>
      <li key={index}><strong>{textValue(gate.id)}</strong> · {gate.passed === true ? '通过' : '未通过'}{Array.isArray(gate.reasons) && gate.reasons.length ? `：${gate.reasons.join('；')}` : ''}</li>
    )}</ul>
  </section>
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}`
}
