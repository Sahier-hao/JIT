import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { fetchAdminModel, formatDate, metricReason, metricValue, valueLabel, type AdminModel } from '../../adminContracts'
import { fetchModelBenefit, type BenefitMetric, type BenefitReport, type ModelBenefit } from '../../benefitContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, MetricGrid } from './AdminShared'

export function AdminModelDetailPage({ modelId, navigate, expired }: {
  modelId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [model, setModel] = useState<AdminModel | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetchAdminModel(modelId, controller.signal).then(setModel).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型详情读取失败')
    })
    return () => controller.abort()
  }, [modelId, expired])
  if (error) return <EmptyState title="模型详情不可用" description={error}><Button onClick={() => navigate({ name: 'admin', view: 'models' })}>返回模型列表</Button></EmptyState>
  if (!model) return <LoadingNotice label="正在校验模型与读取指标"/>
  const source = model.source ?? {}
  return <section>
    <AdminPageHeader title={model.name} meta={model.method}/>
    <div className="admin-detail-actions"><Button onClick={() => navigate({ name: 'admin', view: 'models' })}>返回模型列表</Button><Button onClick={() => navigate({ name: 'admin', view: 'comparisons', models: [model.modelId] })}>加入比较</Button></div>
    <div className="admin-status-line"><span className="source-chip">{model.state === 'ready' ? '已校验' : '不可用'}</span><span>{model.enabled ? '已启用' : '已停用'}</span>{model.isDefault ? <strong>默认模型</strong> : null}</div>
    <MetricGrid metrics={model.metrics}/>
    <BenefitSection modelId={modelId} expired={expired}/>
    <div className="admin-detail-grid">
      <section><h2>身份与能力</h2><dl className="admin-facts">
        <div><dt>模型</dt><dd><code>{model.modelId}</code></dd></div>
        <div><dt>方法</dt><dd>{model.method}</dd></div>
        <div><dt>特征 schema</dt><dd>{model.featureSchemaVersion}</dd></div>
        <div><dt>业务运行</dt><dd><code>{model.runId}</code></dd></div>
        <div><dt>原产物运行</dt><dd><code>{model.artifactRunId}</code></dd></div>
        <div><dt>数据版本</dt><dd><code>{model.artifactDatasetVersion}</code></dd></div>
        <div><dt>产物位置</dt><dd><code>{model.artifactKey}</code></dd></div>
        <div><dt>指标集</dt><dd>{model.metricSet ?? '未提供'}</dd></div>
      </dl></section>
      <section><h2>训练来源</h2><dl className="admin-facts">
        <div><dt>发布者</dt><dd>{valueLabel(source.publisher)}</dd></div>
        <div><dt>来源</dt><dd>{valueLabel(source.url)}</dd></div>
        <div><dt>修订</dt><dd><code>{valueLabel(source.revision)}</code></dd></div>
        <div><dt>训练耗时</dt><dd>{model.trainingSeconds === null || model.trainingSeconds === undefined ? '未提供' : `${model.trainingSeconds.toFixed(2)} 秒`}</dd></div>
        <div><dt>阈值</dt><dd>{model.threshold ?? '未提供'}</dd></div>
      </dl></section>
    </div>
    {model.split ? <section><h2>数据切分</h2><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>分区</th><th>样本</th><th>正例</th><th>开始</th><th>结束</th></tr></thead><tbody>{Object.entries(model.split).map(([name, raw]) => {
      const part = raw as Record<string, unknown>
      return <tr key={name}><th>{name}</th><td>{valueLabel(part.count)}</td><td>{valueLabel(part.positiveCount)}</td><td>{formatDate(part.start)}</td><td>{formatDate(part.end)}</td></tr>
    })}</tbody></table></div></section> : null}
    <section><h2>限制</h2><ul className="admin-limitations">{(model.limitations ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
  </section>
}


function benefitMetric(metric: BenefitMetric, kind: 'percent' | 'number' | 'count') {
  if (metric.value === null) {
    return <>{'—'}{metric.reason ? <small>{metric.reason}</small> : null}</>
  }
  const value = kind === 'percent' ? `${(metric.value * 100).toFixed(1)}%`
    : kind === 'count' ? String(metric.value) : metric.value.toFixed(3)
  return <>{value}</>
}

function RandomMetric({ summary, kind }: {
  summary: { mean: number | null; std: number | null; min: number | null; max: number | null; reason: string | null }
  kind: 'percent' | 'number' | 'count'
}) {
  if (summary.mean === null) return <>{'—'}{summary.reason ? <small>{summary.reason}</small> : null}</>
  const mean = kind === 'percent' ? `${(summary.mean * 100).toFixed(1)}%`
    : kind === 'count' ? summary.mean.toFixed(1) : summary.mean.toFixed(3)
  const spread = summary.std === null ? null
    : kind === 'percent' ? `±${(summary.std * 100).toFixed(1)}%`
      : kind === 'count' ? `±${summary.std.toFixed(1)}` : `±${summary.std.toFixed(3)}`
  const range = summary.min === null || summary.max === null ? null
    : kind === 'percent' ? `${(summary.min * 100).toFixed(0)}–${(summary.max * 100).toFixed(0)}%`
      : kind === 'count' ? `${summary.min.toFixed(0)}–${summary.max.toFixed(0)}` : `${summary.min.toFixed(2)}–${summary.max.toFixed(2)}`
  return <>{mean}{spread ? <small>{spread}{range ? ` · ${range}` : ''}</small> : null}</>
}

function StrategyRow({ name, report }: { name: string; report: BenefitReport['strategies']['model'] }) {
  return <tr>
    <th>{name}</th>
    <td>{benefitMetric(report.recall20Loc, 'percent')}</td>
    <td>{benefitMetric(report.popt, 'number')}</td>
    <td>{benefitMetric(report.ifa, 'count')}</td>
    <td>{report.coverage.issuesCovered}/{report.coverage.positives}</td>
    <td>{report.coverage.selectedCount}</td>
    <td>{report.coverage.usedLoc.toLocaleString()}</td>
  </tr>
}

function BenefitSection({ modelId, expired }: { modelId: string; expired: () => void }) {
  const [benefit, setBenefit] = useState<ModelBenefit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchModelBenefit(modelId, controller.signal)
      .then(value => { if (!controller.signal.aborted) { setBenefit(value); setError('') } })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '收益评估读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [expired, modelId, revision])
  if (loading) return <section className="admin-benefit"><h2>审查收益</h2><p className="quiet-empty" role="status">正在读取收益评估。</p></section>
  if (error) return <section className="admin-benefit"><h2>审查收益</h2><div className="admin-inline-error" role="alert">{error}<Button size="sm" onClick={() => setRevision(value => value + 1)}>重试</Button></div></section>
  if (!benefit?.available) return <section className="admin-benefit"><h2>审查收益</h2><p className="quiet-empty">{benefit?.reason ?? '尚无该模型的收益评估报告。'}</p></section>
  const report = benefit.report!
  const existing = report.existingMetrics
  const random = report.strategies.random
  return <section className="admin-benefit">
    <h2>审查收益</h2>
    <p className="admin-notice" role="status">{report.conclusion.sentence}</p>
    <p className="admin-report-meta">测试 {report.test.records} 条提交 · {report.test.positives} 个历史标记 · 预算 {report.test.budgetLoc.toLocaleString()}/{report.test.totalLoc.toLocaleString()} 行 · 随机 {random.runs} 次（种子 {random.seed}）</p>
    <div className="admin-table-wrap"><table className="admin-table admin-benefit-table">
      <thead><tr><th>策略</th><th>Recall@20%LOC</th><th title="按该策略排序的归一化成本-召回面积；既有密度排序见下方对照">Popt</th><th>IFA</th><th>覆盖正例</th><th>选中提交</th><th>使用行数</th></tr></thead>
      <tbody>
        <StrategyRow name="模型分数" report={report.strategies.model}/>
        <StrategyRow name="时间顺序" report={report.strategies.time}/>
        <tr><th>随机（均值 ± 标准差）</th>
          <td><RandomMetric summary={random.recall20Loc} kind="percent"/></td>
          <td><RandomMetric summary={random.popt} kind="number"/></td>
          <td><RandomMetric summary={random.ifa} kind="count"/></td>
          <td><RandomMetric summary={random.coverage.issuesCovered} kind="count"/></td>
          <td><RandomMetric summary={random.coverage.selectedCount} kind="count"/></td>
          <td><RandomMetric summary={random.coverage.usedLoc} kind="count"/></td>
        </tr>
      </tbody>
    </table></div>
    <details className="admin-report-identity"><summary>既有运行指标对照</summary>
      <dl className="admin-facts">
        <div><dt>AP</dt><dd>{existing && metricValue(existing, 'averagePrecision') !== null ? metricValue(existing, 'averagePrecision')!.toFixed(4) : '未提供'}</dd></div>
        <div><dt>Recall@20%LOC</dt><dd>{existing && metricValue(existing, 'recall20Loc') !== null ? `${(metricValue(existing, 'recall20Loc')! * 100).toFixed(1)}%` : '未提供'}</dd></div>
        <div><dt>Popt（既有密度序）</dt><dd>{existing && metricValue(existing, 'popt') !== null ? metricValue(existing, 'popt')!.toFixed(3) : '未提供'}</dd></div>
        <div><dt>IFA</dt><dd>{existing && metricValue(existing, 'ifa') !== null ? valueLabel(metricValue(existing, 'ifa')) : '未提供'}</dd></div>
      </dl>
      {existing && ['averagePrecision', 'recall20Loc', 'popt', 'ifa'].some(name => metricValue(existing, name) === null && metricReason(existing, name)) ? <p className="admin-report-meta">{['averagePrecision', 'recall20Loc', 'popt', 'ifa'].map(name => {
        const reason = existing && metricValue(existing, name) === null ? metricReason(existing, name) : null
        return reason ? `${name}：${reason}` : null
      }).filter(Boolean).join('；')}</p> : null}
    </details>
    <details className="admin-report-identity"><summary>标签与口径限制</summary><ul className="admin-limitations">{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    <p className="admin-report-meta">只读回顾性评估；未在测试分区调参；风险分数不是缺陷概率；不据此改变默认模型。</p>
  </section>
}
