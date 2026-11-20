import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { formatDate } from '@/features/admin/adminContracts'
import { fetchMultiProjectReports, type MultiProjectReportStatus, type MultiProjectReportSummary } from '@/features/admin/multiProjectReportContracts'
import { fetchEvaluationEvidence, type EvaluationEvidenceEntry, type EvidenceStatus } from '@/features/admin/evaluationEvidenceClient'

import { CardListSkeleton } from '@/components/shared/Skeletons'

import type { Route } from '@/app/navigation'
import { AdminPageHeader, ErrorNotice } from '@/features/admin/AdminShared'

const STATUS_LABELS: Record<MultiProjectReportStatus, string> = {
  complete: '完整', partial: '部分失败', failed: '失败', invalid: '无效',
}
const EVIDENCE_KINDS: Record<string, string> = {
  'evaluation-matrix': '多模型评价矩阵',
  'review-benefit': '审查收益评价',
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
    return `${String(s.datasets ?? '—')} 个数据集 · 时间外 ${String(s.withinRepoCells ?? 0)} 格 · 留一仓库 ${String(s.leaveOneRepoOutCells ?? 0)} 格 · 失败 ${String(s.failures ?? 0)} · ${String(s.budgetProtocol ?? '旧预算协议')}`
  }
  if (entry.kind === 'review-benefit') {
    return `${String(s.datasets ?? '—')} 个数据集 · ${String(s.cells ?? 0)} 个方法格 · 失败 ${String(s.failures ?? 0)} · review-benefit-v3`
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
  const [evidenceLoading, setEvidenceLoading] = useState(true)
  const [evidenceError, setEvidenceError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setEvidenceLoading(true)
    fetchMultiProjectReports(controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setReports(result.reports); setError('')
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setError(failure instanceof Error ? failure.message : '多项目实验报告读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    fetchEvaluationEvidence(controller.signal)
      .then(items => { if (!controller.signal.aborted) { setEvidence(items); setEvidenceError('') } })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) expired()
        else setEvidenceError(failure instanceof Error ? failure.message : '评价证据读取失败')
      })
      .finally(() => { if (!controller.signal.aborted) setEvidenceLoading(false) })
    return () => controller.abort()
  }, [expired, revision])

  return <section>
    <AdminPageHeader title="多项目实验" onRefresh={() => setRevision(value => value + 1)}/>
    <ErrorNotice>{error}</ErrorNotice>
    {!reports.length ? loading ? <CardListSkeleton label="正在读取多项目实验报告" rows={3}/> : error ? null : <p className="text-xs text-foreground-3">报告目录中没有多项目实验报告。</p> : <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>生成时间</TableHead><TableHead>状态</TableHead><TableHead>方法与口径</TableHead><TableHead>项目</TableHead><TableHead>失败</TableHead><TableHead>来源</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
      <TableBody>{reports.map(report => <TableRow key={report.reportId}>
        <TableCell>{formatDate(report.generatedUtc)}</TableCell>
        <TableCell><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{STATUS_LABELS[report.status]}</span>{report.status === 'invalid' && report.error ? <small>{report.error.message}</small> : null}</TableCell>
        <TableCell>{report.methodCount} 种方法 · {report.protocolCount} 种口径<small>{report.metricSet ?? '指标集未提供'}</small></TableCell>
        <TableCell>{report.projectCount} 个项目{report.failedProjectCount ? <small>失败 {report.failedProjectCount}</small> : null}</TableCell>
        <TableCell>{report.failureCount ? report.failureCount : '无'}</TableCell>
        <TableCell><code>{report.source}</code></TableCell>
        <TableCell>{report.status === 'invalid' ? null : <Button size="sm" onClick={() => navigate({ name: 'admin', view: 'experiments', resourceId: report.reportId })} variant="outline" type="button">查看</Button>}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div>}
    <section aria-label="评价证据">
      <h2>评价证据</h2>
      <ErrorNotice>{evidenceError}</ErrorNotice>
      {!evidence.length ? evidenceLoading ? <CardListSkeleton label="正在读取评价证据" rows={1}/> : evidenceError ? null : <p className="text-xs text-foreground-3">固定目录中没有评价矩阵或候选集报告。</p> : <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
        <TableHeader><TableRow><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>事实</TableHead><TableHead>内容 SHA-256</TableHead><TableHead>来源</TableHead></TableRow></TableHeader>
        <TableBody>{evidence.map(entry => <TableRow key={entry.evidenceId}>
          <TableCell>{EVIDENCE_KINDS[entry.kind] ?? entry.kind}</TableCell>
          <TableCell><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{EVIDENCE_STATUS[entry.status]}</span>{entry.reason ? <small>{entry.reason}</small> : null}</TableCell>
          <TableCell>{evidenceSummary(entry)}</TableCell>
          <TableCell><code>{entry.sha256.slice(0, 12)}</code></TableCell>
          <TableCell><code>{entry.source}</code></TableCell>
        </TableRow>)}</TableBody>
      </Table></div>}
    </section>
  </section>
}
