import type { Row } from './adminContracts'

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
  if (!report) return <section><h2>发布门槛</h2><p className="quiet-empty">发布报告尚未生成</p></section>
  const assessment = record(report.assessment)
  const gates = Array.isArray(assessment.gates) ? assessment.gates.map(record) : []
  const worst = releaseWorstProject(report)
  const effort = releaseEffortDeltas(report)
  return <section>
    <h2>发布门槛</h2>
    <dl className="admin-facts">
      <div><dt>最差项目 AP</dt><dd>{worst ? `${worst.project} · ${worst.ap.toFixed(4)}${worst.auc === null ? '' : ` · ROC-AUC ${worst.auc.toFixed(4)}`}` : '无已定义项目'}</dd></div>
    </dl>
    {effort.length ? <div className="model-card-table-wrap"><table className="model-card-table">
      <thead><tr><th>跨项目指标</th><th>模型</th><th>较时间顺序</th><th>较随机均值</th></tr></thead>
      <tbody>{effort.map(item => <tr key={item.metric}>
        <th>{item.metric}</th>
        <td>{item.value.toFixed(4)}</td>
        <td>{signed(item.timeDelta)}</td>
        <td>{signed(item.randomDelta)}</td>
      </tr>)}</tbody>
    </table></div> : null}
    <ul className="admin-limitations">{gates.map((gate, index) =>
      <li key={index}><strong>{textValue(gate.id)}</strong> · {gate.passed === true ? '通过' : '未通过'}{Array.isArray(gate.reasons) && gate.reasons.length ? `：${gate.reasons.join('；')}` : ''}</li>
    )}</ul>
  </section>
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}`
}
