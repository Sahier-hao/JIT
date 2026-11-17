import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { metricReason, metricValue, type Row } from '@/features/admin/adminContracts'
import type { ModelCard, ModelCardBenefit, ModelCardPartition } from '@/features/models/modelCardClient'
import { releaseEffortDeltas, releaseWorstProject } from '@/releaseEvidence'


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
  return <article className="grid gap-1.5 rounded-sm border border-border-soft p-2.5" data-partition={partition.name}>
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-foreground">{modelIdleLabel(partition)}</h3><p className="text-xs text-foreground-3">{partition.available ? `${partition.records ?? '—'} 条 · ${partition.positives ?? '—'} 个正例` : partition.reason ?? '未记录'}</p></div>
      <span className="text-[11px] text-foreground-4">{partition.available ? '已记录' : '未记录'}</span>
    </header>
    {partition.available && partition.metrics ? <dl className="grid gap-0.5 text-xs [&>div]:flex [&>div]:justify-between [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-0.5 [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:tabular-nums">
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
    return <section className="grid gap-2"><h2 className="text-base font-semibold text-foreground">审查收益</h2><p className="text-xs text-foreground-3">{benefit.reason ?? '尚无该模型的收益评估报告'}</p></section>
  }
  const model = record(benefit.strategies.model)
  const time = record(benefit.strategies.time)
  const density = benefit.strategies.density == null ? null : record(benefit.strategies.density)
  const loc = benefit.strategies.loc == null ? null : record(benefit.strategies.loc)
  const random = record(benefit.strategies.random)
  const sentence = valueText(benefit.conclusion.sentence, '收益结论未提供')
  const protocol = benefit.protocol ?? {}
  const intervals = ['modelVsDensity', 'modelVsLoc', 'modelVsTime', 'modelVsRandomMean']
    .map(key => record(record(benefit.comparisons ?? {})[key]).recall20LocInterval)
    .filter(value => value !== undefined)
    .map(value => record(value))
  const intervalRuns = Math.max(0, ...intervals.map(value => typeof value.validRuns === 'number' ? value.validRuns : 0))
  const intervalReason = intervals.map(value => value.reason).find(value => typeof value === 'string')
  return <section className="grid gap-2">
    <h2 className="text-base font-semibold text-foreground">审查收益</h2>
    <p className="rounded-sm bg-accent-soft p-2.5 text-sm text-foreground" role="status">{sentence}</p>
    <p className="text-xs leading-body text-foreground-3">
      协议 {valueText(protocol.name, '未提供')} · 报告版本 {valueText(benefit.reportVersion, '未提供')} ·
      {intervalRuns > 0 ? ` 配对区间 ${intervalRuns} 次重采样` : ` 配对区间不足${intervalReason ? `：${intervalReason}` : ''}`}
    </p>
    <div className="overflow-x-auto rounded-sm border border-border-soft"><Table className="w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
      <TableHeader><TableRow><TableHead>检查顺序</TableHead><TableHead>Recall@20%LOC</TableHead><TableHead>Popt</TableHead><TableHead>IFA</TableHead><TableHead>覆盖正例</TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow><TableHead>模型分数</TableHead><TableCell>{benefitMetric(model, 'recall20Loc', 'percent')}</TableCell><TableCell>{benefitMetric(model, 'popt', 'number')}</TableCell><TableCell>{benefitMetric(model, 'ifa', 'count')}</TableCell><TableCell>{coverageText(model)}</TableCell></TableRow>
        {density ? <TableRow><TableHead>风险/成本密度</TableHead><TableCell>{benefitMetric(density, 'recall20Loc', 'percent')}</TableCell><TableCell>{benefitMetric(density, 'popt', 'number')}</TableCell><TableCell>{benefitMetric(density, 'ifa', 'count')}</TableCell><TableCell>{coverageText(density)}</TableCell></TableRow> : null}
        {loc ? <TableRow><TableHead>改动量升序</TableHead><TableCell>{benefitMetric(loc, 'recall20Loc', 'percent')}</TableCell><TableCell>{benefitMetric(loc, 'popt', 'number')}</TableCell><TableCell>{benefitMetric(loc, 'ifa', 'count')}</TableCell><TableCell>{coverageText(loc)}</TableCell></TableRow> : null}
        <TableRow><TableHead>时间顺序</TableHead><TableCell>{benefitMetric(time, 'recall20Loc', 'percent')}</TableCell><TableCell>{benefitMetric(time, 'popt', 'number')}</TableCell><TableCell>{benefitMetric(time, 'ifa', 'count')}</TableCell><TableCell>{coverageText(time)}</TableCell></TableRow>
        <TableRow><TableHead>随机均值</TableHead><TableCell>{randomMetric(random.recall20Loc, 'percent')}</TableCell><TableCell>{randomMetric(random.popt, 'number')}</TableCell><TableCell>{randomMetric(random.ifa, 'count')}</TableCell><TableCell>—</TableCell></TableRow>
      </TableBody>
    </Table></div>
    <p className="text-xs leading-body text-foreground-3">只读回顾性评估；检查顺序不代表缺陷概率，也不用于自动选择模型。</p>
    {benefit.limitations.length ? <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">{benefit.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
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
    return <div className="grid justify-items-start gap-2 rounded-sm border border-rose/30 bg-rose-soft p-3 text-xs text-rose-deep" role="alert"><strong>{card.name}</strong><p>{card.reason ?? '模型卡不可用'}</p>{retry ? <Button size="sm" onClick={retry} variant="outline" type="button">重试</Button> : null}</div>
  }
  const scale = card.dataScale ?? {}
  const performance = card.trainingPerformance ?? {}
  const source = card.source ?? {}
  const maturity = record(card.maturity)
  const maturityCounts = record(maturity.statusCounts)
  const worstReleaseProject = releaseWorstProject(card.release)
  const releaseEffort = releaseEffortDeltas(card.release)
  return <div className="grid gap-3">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-foreground">{card.name}</h2><p className="text-xs text-foreground-3">{card.method ?? '方法未提供'} · {card.featureSchemaVersion ?? 'schema 未提供'}</p></div>
      <span className="text-xs text-foreground-3" data-available={card.available}>{card.available ? '可用于项目分析' : card.reason ?? '不可用'}</span>
    </header>
    {!card.available ? <div className="grid justify-items-start gap-2 rounded-sm border border-rose/30 bg-rose-soft p-3 text-xs text-rose-deep" role="alert"><strong>当前模型不可用</strong><p>{card.reason ?? '无法加载模型产物'}{retry ? <Button size="sm" onClick={retry} variant="outline" type="button">重试</Button> : null}</p></div> : null}
    <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
      <div><dt>数据规模</dt><dd>{valueText(scale.records)} 条 · {valueText(scale.featureWidth)} 维输入</dd></div>
      <div><dt>切分</dt><dd>{card.splitRule ?? '未记录'}</dd></div>
      <div><dt>训练耗时</dt><dd>{typeof performance.durationSeconds === 'number' ? `${performance.durationSeconds.toFixed(2)} 秒` : '未记录'}</dd></div>
      <div><dt>训练吞吐</dt><dd>{typeof performance.recordsPerSecond === 'number' ? `${performance.recordsPerSecond.toFixed(1)} 条/秒` : '未记录'}</dd></div>
      <div><dt>数据版本</dt><dd><code>{card.datasetVersion ?? '未记录'}</code></dd></div>
      <div><dt>来源</dt><dd>{valueText(source.publisher)}{source.revision ? ` · ${valueText(source.revision)}` : ''}</dd></div>
      <div><dt>标签成熟</dt><dd>{valueText(maturity.effectivePolicy, '未记录')} · 未成熟排除 {valueText(maturity.excludedImmature, '—')}</dd></div>
      <div><dt>成熟状态计数</dt><dd>{Object.keys(maturityCounts).length ? Object.entries(maturityCounts).map(([name, count]) => `${name} ${valueText(count)}`).join(' · ') : '未记录'}</dd></div>
    </dl>
    <section className="grid gap-2">
      <h2 className="text-base font-semibold text-foreground">分区指标</h2>
      <div className="grid gap-2 sm:grid-cols-3">{card.partitions.map(partition => <PartitionCard key={partition.name} partition={partition}/>)}</div>
      {card.diagnostics?.reason ? <p className="text-xs leading-body text-foreground-3">{valueText(card.diagnostics.reason)}</p> : null}
    </section>
    <section className="grid gap-2">
      <h2 className="text-base font-semibold text-foreground">发布资格</h2>
      {card.release.available ? <>
        <p className="rounded-sm bg-accent-soft p-2.5 text-sm text-foreground" role="status">{card.release.status === 'qualified' ? '已通过 jit-release-v1 发布门槛' : '未通过正式发布门槛'}</p>
        <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
          <div><dt>发布报告</dt><dd><code>{card.release.reportId}</code></dd></div>
          <div><dt>人工默认候选</dt><dd>{card.release.approvedDefault ? '已批准（导入不覆盖既有默认）' : '未批准'}</dd></div>
          <div><dt>最差项目 AP</dt><dd>{worstReleaseProject ? `${worstReleaseProject.project} · ${worstReleaseProject.ap.toFixed(4)}${worstReleaseProject.auc === null ? '' : ` · ROC-AUC ${worstReleaseProject.auc.toFixed(4)}`}` : '无已定义项目'}</dd></div>
        </dl>
        {releaseEffort.length ? <div className="overflow-x-auto rounded-sm border border-border-soft"><Table className="w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_td]:border-b [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1.5 [&_td]:tabular-nums">
          <TableHeader><TableRow><TableHead>跨项目指标</TableHead><TableHead>模型</TableHead><TableHead>较时间顺序</TableHead><TableHead>较随机均值</TableHead></TableRow></TableHeader>
          <TableBody>{releaseEffort.map(item => <TableRow key={item.metric}>
            <TableHead>{item.metric}</TableHead><TableCell>{item.value.toFixed(4)}</TableCell>
            <TableCell>{signed(item.timeDelta)}</TableCell><TableCell>{signed(item.randomDelta)}</TableCell>
          </TableRow>)}</TableBody>
        </Table></div> : null}
        <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">{card.release.gates.map((gate, index) => <li key={index}><strong>{valueText(gate.id)}</strong> · {gate.passed === true ? '通过' : '未通过'}{Array.isArray(gate.reasons) && gate.reasons.length ? `：${gate.reasons.join('；')}` : ''}</li>)}</ul>
      </> : <p className="text-xs text-foreground-3">{card.release.reason ?? '尚无匹配的发布资格报告'}</p>}
    </section>
    <BenefitView benefit={card.benefit}/>
    <section className="grid gap-2"><h2 className="text-base font-semibold text-foreground">限制</h2>{card.limitations.length ? <ul className="list-disc pl-5 text-xs leading-body text-foreground-3">{card.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="text-xs text-foreground-3">未记录限制说明。</p>}</section>
  </div>
}

function signed(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}`
}
