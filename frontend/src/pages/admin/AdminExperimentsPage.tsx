import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { formatDate } from '../../adminContracts'
import { fetchMultiProjectReports, type MultiProjectReportStatus, type MultiProjectReportSummary } from '../../multiProjectReportContracts'
import { fetchEvaluationEvidence, type EvaluationEvidenceEntry, type EvidenceStatus } from '../../evaluationEvidenceClient'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const STATUS_LABELS: Record<MultiProjectReportStatus, string> = {
  complete: '完整', partial: '部分失败', failed: '失败', invalid: '无效',
}
const EVIDENCE_KINDS: Record<string, string> = {
  'evaluation-matrix': '多模型评价矩阵',
  'line-candidate-evaluation': '完整候选定位评价',
  'line-candidates': '完整候选集',
  invalid: '无效证据',
}
const EVIDENCE_STATUS: Record<EvidenceStatus, string> = {
  available: '可用', stale: '已陈旧', invalid: '无效',
}
function evidenceSummary(entry: EvaluationEvidenceEntry): string {
  const s = entry.summary ?? {}
  if (entry.kind === 'evaluation-matrix') {
    return `${String(s.datasets ?? '—')} 个数据集 · 时间外 ${String(s.withinRepoCells ?? 0)} 格 · 留一仓库 ${String(s.leaveOneRepoOutCells ?? 0)} 格 · 失败 ${String(s.failures ?? 0)}`
  }
  if (entry.kind === 'line-candidate-evaluation') {
    return `${String(s.repos ?? '—')} 个仓库 · ${String(s.candidates ?? 0)} 条候选 · ${String(s.positives ?? 0)} 个正例`
  }
  if (entry.kind === 'line-candidates') {
    return `${String(s.repo ?? '—')} · ${String(s.candidates ?? 0)} 条候选 · ${String(s.positives ?? 0)} 个正例 · 不可覆盖 ${String(s.uncoverable ?? 0)}`
  }
  return '—'
}

export function AdminExperimentsPage({ navigate, expired }: {
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [reports, setReports] = useState<MultiProjectReportSummary[]>([])
  const [evidence, setEvidence] = useState<EvaluationEvidenceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all([fetchMultiProjectReports(controller.signal), fetchEvaluationEvidence(controller.signal)])
      .then(([result, items]) => {
        if (controller.signal.aborted) return
        setReports(result.reports); setEvidence(items); setError('')
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '多项目实验报告读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [expired, revision])

  if (loading) return <LoadingNotice label="正在读取多项目实验报告"/>
  if (error && !reports.length) return <EmptyState title="多项目实验报告不可用" description={error}>
    <Button onClick={() => setRevision(value => value + 1)}>重试</Button>
  </EmptyState>
  return <section>
    <AdminPageHeader title="多项目实验" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    {!reports.length ? <p className="quiet-empty">报告目录中没有多项目实验报告。</p> : <div className="admin-table-wrap"><table className="admin-table">
      <thead><tr><th>生成时间</th><th>状态</th><th>方法与口径</th><th>项目</th><th>失败</th><th>来源</th><th><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{reports.map(report => <tr key={report.reportId}>
        <td>{formatDate(report.generatedUtc)}</td>
        <td><span className="source-chip">{STATUS_LABELS[report.status]}</span>{report.status === 'invalid' && report.error ? <small>{report.error.message}</small> : null}</td>
        <td>{report.methodCount} 种方法 · {report.protocolCount} 种口径<small>{report.metricSet ?? '指标集未提供'}</small></td>
        <td>{report.projectCount} 个项目{report.failedProjectCount ? <small>失败 {report.failedProjectCount}</small> : null}</td>
        <td>{report.failureCount ? report.failureCount : '无'}</td>
        <td><code>{report.source}</code></td>
        <td>{report.status === 'invalid' ? null : <Button size="sm" onClick={() => navigate({ name: 'admin', view: 'experiments', resourceId: report.reportId })}>查看</Button>}</td>
      </tr>)}</tbody>
    </table></div>}
    <section aria-label="评价证据">
      <h2>评价证据</h2>
      {!evidence.length ? <p className="quiet-empty">固定目录中没有评价矩阵或候选集报告。</p> : <div className="admin-table-wrap"><table className="admin-table">
        <thead><tr><th>类型</th><th>状态</th><th>事实</th><th>内容 SHA-256</th><th>来源</th></tr></thead>
        <tbody>{evidence.map(entry => <tr key={entry.evidenceId}>
          <td>{EVIDENCE_KINDS[entry.kind] ?? entry.kind}</td>
          <td><span className="source-chip">{EVIDENCE_STATUS[entry.status]}</span>{entry.reason ? <small>{entry.reason}</small> : null}</td>
          <td>{evidenceSummary(entry)}</td>
          <td><code>{entry.sha256.slice(0, 12)}</code></td>
          <td><code>{entry.source}</code></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </section>
}
