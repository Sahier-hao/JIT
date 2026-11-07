import { metricReason, metricValue, type Row } from '../adminContracts'
import type { ModelCard, ModelCardBenefit, ModelCardPartition } from '../modelCardClient'
import { Button } from '../ui/controls'

const METRICS = [
  ['averagePrecision', 'AP'],
  ['rocAuc', 'ROC-AUC'],
  ['recall20Loc', 'Recall@20%LOC'],
  ['popt', 'Popt'],
  ['ifa', 'IFA'],
] as const

function valueText(value: unknown, fallback = '未提供') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback
}

function benefitMetric(metrics: Row | null, key: string, kind: 'percent' | 'number' | 'count') {
  const value = metricValue(metrics, key)
  if (value === null) {
    const reason = metricReason(metrics, key)
    return <>{'—'}{reason ? <small>{reason}</small> : null}</>
  }
  if (kind === 'percent') return `${(value * 100).toFixed(1)}%`
  if (kind === 'count') return String(Math.round(value))
  return value.toFixed(3)
}

function randomMetric(raw: unknown, kind: 'percent' | 'number' | 'count') {
  const summary = record(raw)
  const mean = typeof summary.mean === 'number' && Number.isFinite(summary.mean) ? summary.mean : null
  if (mean === null) return <>{'—'}{valueText(summary.reason, '')}</>
  const text = kind === 'percent' ? `${(mean * 100).toFixed(1)}%`
    : kind === 'count' ? mean.toFixed(1) : mean.toFixed(3)
  const std = typeof summary.std === 'number' && Number.isFinite(summary.std) ? summary.std : null
  return <>{text}{std === null ? null : <small>±{kind === 'percent' ? `${(std * 100).toFixed(1)}%` : kind === 'count' ? std.toFixed(1) : std.toFixed(3)}</small>}</>
}

function modelIdleLabel(partition: ModelCardPartition) {
  if (partition.name === 'train') return '拟合诊断'
  if (partition.name === 'validation') return '模型选择背景'
  return '冻结泛化评价'
}

function PartitionCard({ partition }: { partition: ModelCardPartition }) {
  return <article className="model-partition-card" data-partition={partition.name}>
    <header>
      <div><h3>{modelIdleLabel(partition)}</h3><p>{partition.available ? `${partition.records ?? '—'} 条 · ${partition.positives ?? '—'} 个正例` : partition.reason ?? '未记录'}</p></div>
      <span>{partition.available ? '已记录' : '未记录'}</span>
    </header>
    {partition.available && partition.metrics ? <dl className="model-partition-metrics">
      {METRICS.map(([key, label]) => {
        const value = metricValue(partition.metrics, key)
        const reason = metricReason(partition.metrics, key)
        return <div key={key}><dt>{label}</dt><dd>{value === null ? <>{'—'}<small>{reason ?? '未定义'}</small></> : value.toFixed(4)}</dd></div>
      })}
    </dl> : null}
  </article>
}

function BenefitView({ benefit }: { benefit: ModelCardBenefit }) {
  if (!benefit.available || !benefit.conclusion || !benefit.strategies) {
    return <section className="model-card-section"><h2>审查收益</h2><p className="quiet-empty">{benefit.reason ?? '尚无该模型的收益评估报告'}</p></section>
  }
  const model = record(benefit.strategies.model)
  const time = record(benefit.strategies.time)
  const random = record(benefit.strategies.random)
  const sentence = valueText(benefit.conclusion.sentence, '收益结论未提供')
  return <section className="model-card-section model-card-benefit">
    <h2>审查收益</h2>
    <p className="model-card-callout" role="status">{sentence}</p>
    <div className="model-card-table-wrap"><table className="model-card-table">
      <thead><tr><th>检查顺序</th><th>Recall@20%LOC</th><th>Popt</th><th>IFA</th><th>覆盖正例</th></tr></thead>
      <tbody>
        <tr><th>模型分数</th><td>{benefitMetric(model, 'recall20Loc', 'percent')}</td><td>{benefitMetric(model, 'popt', 'number')}</td><td>{benefitMetric(model, 'ifa', 'count')}</td><td>{coverageText(model)}</td></tr>
        <tr><th>时间顺序</th><td>{benefitMetric(time, 'recall20Loc', 'percent')}</td><td>{benefitMetric(time, 'popt', 'number')}</td><td>{benefitMetric(time, 'ifa', 'count')}</td><td>{coverageText(time)}</td></tr>
        <tr><th>随机均值</th><td>{randomMetric(random.recall20Loc, 'percent')}</td><td>{randomMetric(random.popt, 'number')}</td><td>{randomMetric(random.ifa, 'count')}</td><td>—</td></tr>
      </tbody>
    </table></div>
    <p className="model-card-note">只读回顾性评估；检查顺序不代表缺陷概率，也不用于自动选择模型。</p>
    {benefit.limitations.length ? <ul className="model-card-limitations">{benefit.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
  </section>
}

function coverageText(strategy: Row) {
  const coverage = record(strategy.coverage)
  const covered = valueText(coverage.issuesCovered, '—')
  const positives = valueText(coverage.positives, '—')
  return `${covered}/${positives}`
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

export function ModelCardView({ card, retry }: { card: ModelCard; retry?: () => void }) {
  if (!card.available && !card.method) {
    return <div className="model-card-unavailable" role="alert"><strong>{card.name}</strong><p>{card.reason ?? '模型卡不可用'}</p>{retry ? <Button size="sm" onClick={retry}>重试</Button> : null}</div>
  }
  const scale = card.dataScale ?? {}
  const performance = card.trainingPerformance ?? {}
  const source = card.source ?? {}
  return <div className="model-card">
    <header className="model-card-head">
      <div><h2>{card.name}</h2><p>{card.method ?? '方法未提供'} · {card.featureSchemaVersion ?? 'schema 未提供'}</p></div>
      <span data-available={card.available}>{card.available ? '可用于项目分析' : card.reason ?? '不可用'}</span>
    </header>
    {!card.available ? <div className="model-card-unavailable" role="alert"><strong>当前模型不可用</strong><p>{card.reason ?? '无法加载模型产物'}{retry ? <Button size="sm" onClick={retry}>重试</Button> : null}</p></div> : null}
    <dl className="model-card-facts">
      <div><dt>数据规模</dt><dd>{valueText(scale.records)} 条 · {valueText(scale.featureWidth)} 维输入</dd></div>
      <div><dt>切分</dt><dd>{card.splitRule ?? '未记录'}</dd></div>
      <div><dt>训练耗时</dt><dd>{typeof performance.durationSeconds === 'number' ? `${performance.durationSeconds.toFixed(2)} 秒` : '未记录'}</dd></div>
      <div><dt>训练吞吐</dt><dd>{typeof performance.recordsPerSecond === 'number' ? `${performance.recordsPerSecond.toFixed(1)} 条/秒` : '未记录'}</dd></div>
      <div><dt>数据版本</dt><dd><code>{card.datasetVersion ?? '未记录'}</code></dd></div>
      <div><dt>来源</dt><dd>{valueText(source.publisher)}{source.revision ? ` · ${valueText(source.revision)}` : ''}</dd></div>
    </dl>
    <section className="model-card-section">
      <h2>分区指标</h2>
      <div className="model-partition-grid">{card.partitions.map(partition => <PartitionCard key={partition.name} partition={partition}/>)}</div>
      {card.diagnostics?.reason ? <p className="model-card-note">{valueText(card.diagnostics.reason)}</p> : null}
    </section>
    <BenefitView benefit={card.benefit}/>
    <section className="model-card-section"><h2>限制</h2>{card.limitations.length ? <ul className="model-card-limitations">{card.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="quiet-empty">未记录限制说明。</p>}</section>
  </div>
}
