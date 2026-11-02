import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { formatDate, metricReason, metricValue, valueLabel, type Row } from '../../adminContracts'
import {
  fetchMultiProjectReport, type MultiProjectReportDetail, type ReportAggregate, type ReportProject,
  type ReportProtocol, type ReportTarget,
} from '../../multiProjectReportContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button, Select } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const STATUS_LABELS: Record<string, string> = {
  complete: '完整', partial: '部分失败', failed: '失败', invalid: '无效',
  succeeded: '成功',
}
const METHOD_LABELS: Record<string, string> = {
  'logistic-regression-l2-v1': '逻辑回归',
  'decision-tree-v1': '决策树',
  'random-forest-v1': '随机森林',
  'gaussian-naive-bayes-v1': 'Gaussian NB',
  'gradient-boosting-v1': '梯度提升树',
}
const PROTOCOL_LABELS: Record<string, string> = {
  local: '本地训练', pooled: '合并训练', 'leave-one-project-out': '留一项目', 'global+local': '全局+本地',
}
const METRICS = [
  ['averagePrecision', 'AP'], ['rocAuc', 'ROC-AUC'], ['recall20Loc', 'Recall@20%LOC'],
  ['popt', 'Popt'], ['ifa', 'IFA'],
] as const

const methodLabel = (value: string) => METHOD_LABELS[value] ?? value
const protocolLabel = (value: string) => PROTOCOL_LABELS[value] ?? value
const statusLabel = (value: string) => STATUS_LABELS[value] ?? value

function MetricCell({ metrics, name }: { metrics: Row; name: string }) {
  const value = metricValue(metrics, name)
  const reason = metricReason(metrics, name)
  return <td>{value === null ? '—' : value.toFixed(4)}{value === null && reason ? <small>{reason}</small> : null}</td>
}

function summaryCell(metric: ReportAggregate | undefined, field: 'macroMean' | 'populationVariance') {
  if (!metric) return <td>—</td>
  const value = metric[field]
  const reasons = metric.undefined.map(item => `${item.project}：${item.reason}`)
  return <td>{value === null ? '—' : value.toFixed(4)}{value === null && reasons.length ? <small title={reasons.join('；')}>未定义 {metric.undefined.length} 项</small> : null}</td>
}

function ProjectRow({ project }: { project: ReportProject }) {
  const partitions = ['train', 'validation', 'test'].map(name => {
    const part = project.partitions[name]
    return part ? `${part.count ?? '—'}/${part.positiveCount ?? '—'}` : '—'
  })
  return <tr>
    <td><strong>{project.name}</strong><small>{project.version ?? '版本未提供'}</small></td>
    <td><span className="source-chip">{statusLabel(project.status)}</span>{project.failure ? <small>{project.failure.code}: {project.failure.message}</small> : null}</td>
    <td>{project.includedRows ?? '—'} / {project.positiveLabels ?? '—'}</td>
    <td>{partitions.join(' · ')}</td>
    <td>{project.schema ?? '—'}<small>{project.revision ? project.revision.slice(0, 12) : '修订未提供'}</small></td>
    <td>{project.url ? <a href={project.url} target="_blank" rel="noreferrer">来源</a> : '—'}</td>
  </tr>
}

function TargetRow({ target, protocol }: { target: ReportTarget; protocol: string }) {
  return <tr>
    <td><strong>{target.project}</strong><small>{protocolLabel(protocol)}</small></td>
    <td><span className="source-chip">{statusLabel(target.status)}</span>{target.failure ? <small>{target.failure.code}: {target.failure.message}</small> : null}</td>
    {METRICS.map(([key]) => <MetricCell key={key} metrics={target.metrics} name={key}/>)}
    <td>{target.trainingProjects.length ? target.trainingProjects.join(', ') : '—'}</td>
    <td>{target.blend
      ? <>全局 {target.blend.alphaGlobal} / 本地 {target.blend.alphaLocal}<small>验证 Brier {target.blend.validationBrier?.toFixed(4) ?? '—'} · {target.blend.validationCount ?? '—'} 条</small></>
      : '—'}</td>
  </tr>
}

function ProtocolSection({ protocol, result }: { protocol: string; result: ReportProtocol | undefined }) {
  if (!result) return <details className="admin-report-protocol"><summary>{protocolLabel(protocol)} · 未提供</summary></details>
  return <details className="admin-report-protocol" open={protocol === 'local'}>
    <summary>{protocolLabel(protocol)} · {statusLabel(result.status)} · {result.targets.length} 个目标</summary>
    <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>目标项目</th><th>状态</th>{METRICS.map(([key, name]) => <th key={key}>{name}</th>)}<th>训练来源</th><th>融合权重</th></tr></thead>
      <tbody>{result.targets.length ? result.targets.map(target => <TargetRow key={target.project} target={target} protocol={protocol}/>)
        : <tr><td colSpan={9}>没有目标结果。</td></tr>}</tbody>
    </table></div>
  </details>
}

function reportMethod(report: MultiProjectReportDetail, method: string) {
  return report.report.results[method] ?? {}
}

export function AdminExperimentDetailPage({ reportId, navigate, expired }: {
  reportId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [report, setReport] = useState<MultiProjectReportDetail | null>(null)
  const [method, setMethod] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchMultiProjectReport(reportId, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setReport(result); setError('') } })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '多项目实验报告读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [expired, reportId, revision])

  if (loading) return <LoadingNotice label="正在读取多项目实验报告"/>
  if (error || !report) return <EmptyState title="多项目实验报告不可用" description={error || '报告不存在'} tone="alert">
    <Button onClick={() => setRevision(value => value + 1)}>重试</Button>
    <Button onClick={() => navigate({ name: 'admin', view: 'experiments' })}>返回实验列表</Button>
  </EmptyState>

  const selected = report.methods.includes(method) ? method : report.methods[0] ?? ''
  const results = reportMethod(report, selected)
  return <section>
    <AdminPageHeader title="多项目实验报告" meta={`${report.source} · ${formatDate(report.generatedUtc)}`}
      actions={<Button onClick={() => navigate({ name: 'admin', view: 'experiments' })}>返回实验列表</Button>}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="admin-status-line">
      <span className="source-chip">{statusLabel(report.status)}</span>
      <span>{report.schema ?? 'schema 未提供'}</span>
      <span>{report.metricSet ?? '指标集未提供'}</span>
      <span>{report.methodCount} 种方法 · {report.protocolCount} 种口径</span>
      <span>{report.projectCount} 个项目 · 失败 {report.failureCount}</span>
    </div>
    <p className="admin-notice" role="status">只读报告；宏平均不是全局最佳模型，不改变默认模型。融合权重只用各目标项目的验证段选择。</p>

    <h2 className="admin-report-heading">数据与项目</h2>
    <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>项目</th><th>状态</th><th>纳入 / 正例</th><th>训练 · 验证 · 测试</th><th>schema / 修订</th><th>来源</th></tr></thead>
      <tbody>{report.report.projects.map(project => <ProjectRow key={project.name} project={project}/>)}</tbody>
    </table></div>
    {report.report.projects.some(project => project.limitations.length) ? <details className="admin-report-identity">
      <summary>标签语义与限制</summary>
      <dl className="admin-facts">{report.report.projects.map(project => <div key={project.name}>
        <dt>{project.name}</dt>
        <dd>{project.labelRule ?? '标签规则未提供'}{project.limitations.length ? <small>{project.limitations.join('；')}</small> : null}</dd>
      </div>)}</dl>
    </details> : null}

    <h2 className="admin-report-heading">训练方式与目标指标</h2>
    <div className="admin-compare-picker"><Select ariaLabel="实验方法" value={selected} onChange={setMethod}
      options={report.methods.map(value => ({ value, label: methodLabel(value) }))}/></div>
    <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>训练方式</th><th>状态</th><th>AP 宏平均</th><th>AP 方差</th><th>ROC-AUC</th><th>Recall@20%LOC</th><th>Popt</th><th>IFA</th><th>最差项目</th></tr></thead>
      <tbody>{report.protocols.map(name => {
        const result = results[name]
        const worst = result?.worstProjectByPrimaryMetric
        return <tr key={name}>
          <th>{protocolLabel(name)}</th>
          <td><span className="source-chip">{statusLabel(result?.status ?? '未提供')}</span></td>
          {summaryCell(result?.metrics.averagePrecision, 'macroMean')}
          {summaryCell(result?.metrics.averagePrecision, 'populationVariance')}
          {summaryCell(result?.metrics.rocAuc, 'macroMean')}
          {summaryCell(result?.metrics.recall20Loc, 'macroMean')}
          {summaryCell(result?.metrics.popt, 'macroMean')}
          {summaryCell(result?.metrics.ifa, 'macroMean')}
          <td>{worst?.project ?? '—'}{worst?.value != null ? <small>{worst.value.toFixed(4)}</small> : null}</td>
        </tr>
      })}</tbody>
    </table></div>
    <div className="admin-report-protocols">{report.protocols.map(name => <ProtocolSection key={name} protocol={name} result={results[name]}/>)}</div>

    <h2 className="admin-report-heading">失败记录</h2>
    {report.report.failures.length ? <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>阶段</th><th>方法 / 口径</th><th>项目</th><th>错误</th><th>训练来源</th></tr></thead>
      <tbody>{report.report.failures.map((failure, index) => <tr key={index}>
        <td>{failure.stage ?? '—'}</td>
        <td>{failure.method ? methodLabel(failure.method) : '—'}{failure.protocol ? ` · ${protocolLabel(failure.protocol)}` : ''}</td>
        <td>{failure.project ?? '—'}</td>
        <td><code>{failure.code ?? '—'}</code><small>{failure.message ?? '未提供原因'}</small></td>
        <td>{failure.trainingProjects.join(', ') || '—'}</td>
      </tr>)}</tbody>
    </table></div> : <p className="quiet-empty">报告没有失败记录。</p>}

    <details className="admin-report-identity">
      <summary>运行身份与边界</summary>
      <dl className="admin-facts">
        <div><dt>报告版本</dt><dd>{report.report.reportVersion}</dd></div>
        <div><dt>生成时间</dt><dd>{formatDate(report.report.generatedUtc)}</dd></div>
        <div><dt>Python / 平台</dt><dd>{valueLabel(report.report.environment.python)} / {valueLabel(report.report.environment.platform)}</dd></div>
        <div><dt>离线 / 自动选模型</dt><dd>{String(report.report.boundary.offlineOnly ?? '未提供')} / {String(report.report.boundary.automaticModelSelection ?? '未提供')}</dd></div>
        <div><dt>改变默认模型 / 宣布最佳方法</dt><dd>{String(report.report.boundary.defaultModelChanged ?? '未提供')} / {String(report.report.boundary.bestMethodDeclared ?? '未提供')}</dd></div>
        <div><dt>代码哈希</dt><dd>{Object.entries(report.report.sourceCode).map(([name, hash]) => `${name}: ${String(hash).slice(0, 12)}`).join(' · ') || '未提供'}</dd></div>
      </dl>
    </details>
  </section>
}
