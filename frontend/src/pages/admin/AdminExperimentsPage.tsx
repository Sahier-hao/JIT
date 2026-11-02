import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { formatDate } from '../../adminContracts'
import { fetchMultiProjectReports, type MultiProjectReportStatus, type MultiProjectReportSummary } from '../../multiProjectReportContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'
import { Button } from '../../ui/controls'
import type { Route } from '../../navigation'
import { AdminPageHeader, ErrorNotice } from './AdminShared'

const STATUS_LABELS: Record<MultiProjectReportStatus, string> = {
  complete: '完整', partial: '部分失败', failed: '失败', invalid: '无效',
}

export function AdminExperimentsPage({ navigate, expired }: {
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [reports, setReports] = useState<MultiProjectReportSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchMultiProjectReports(controller.signal)
      .then(result => { if (!controller.signal.aborted) { setReports(result.reports); setError('') } })
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
  </section>
}
