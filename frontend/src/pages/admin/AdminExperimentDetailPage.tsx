import { TableCell, TableRow, Table, TableHeader, TableHead, TableBody } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '../../apiContract'
import { formatDate, metricReason, metricValue, valueLabel, type Row } from '../../adminContracts'
import {
  fetchMultiProjectReport, type MultiProjectReportDetail, type ReportAggregate, type ReportProject,
  type ReportProtocol, type ReportTarget,
} from '../../multiProjectReportContracts'
import { EmptyState, LoadingNotice } from '../../Feedback'

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
  return <TableCell>{value === null ? '—' : value.toFixed(4)}{value === null && reason ? <small>{reason}</small> : null}</TableCell>
}

function summaryCell(metric: ReportAggregate | undefined, field: 'macroMean' | 'populationVariance') {
  if (!metric) return <TableCell>—</TableCell>
  const value = metric[field]
  const reasons = metric.undefined.map(item => `${item.project}：${item.reason}`)
  return <TableCell>{value === null ? '—' : value.toFixed(4)}{value === null && reasons.length ? <small title={reasons.join('；')}>未定义 {metric.undefined.length} 项</small> : null}</TableCell>
}

function ProjectRow({ project }: { project: ReportProject }) {
  const partitions = ['train', 'validation', 'test'].map(name => {
    const part = project.partitions[name]
    return part ? `${part.count ?? '—'}/${part.positiveCount ?? '—'}` : '—'
  })
  return <TableRow>
    <TableCell><strong>{project.name}</strong><small>{project.version ?? '版本未提供'}</small></TableCell>
    <TableCell><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{statusLabel(project.status)}</span>{project.failure ? <small>{project.failure.code}: {project.failure.message}</small> : null}</TableCell>
    <TableCell>{project.includedRows ?? '—'} / {project.positiveLabels ?? '—'}</TableCell>
    <TableCell>{partitions.join(' · ')}</TableCell>
    <TableCell>{project.schema ?? '—'}<small>{project.revision ? project.revision.slice(0, 12) : '修订未提供'}</small></TableCell>
    <TableCell>{project.url ? <a href={project.url} target="_blank" rel="noreferrer">来源</a> : '—'}</TableCell>
  </TableRow>
}

function TargetRow({ target, protocol }: { target: ReportTarget; protocol: string }) {
  return <TableRow>
    <TableCell><strong>{target.project}</strong><small>{protocolLabel(protocol)}</small></TableCell>
    <TableCell><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{statusLabel(target.status)}</span>{target.failure ? <small>{target.failure.code}: {target.failure.message}</small> : null}</TableCell>
    {METRICS.map(([key]) => <MetricCell key={key} metrics={target.metrics} name={key}/>)}
    <TableCell>{target.trainingProjects.length ? target.trainingProjects.join(', ') : '—'}</TableCell>
    <TableCell>{target.blend
      ? <>全局 {target.blend.alphaGlobal} / 本地 {target.blend.alphaLocal}<small>验证 Brier {target.blend.validationBrier?.toFixed(4) ?? '—'} · {target.blend.validationCount ?? '—'} 条</small></>
      : '—'}</TableCell>
  </TableRow>
}

function ProtocolSection({ protocol, result }: { protocol: string; result: ReportProtocol | undefined }) {
  if (!result) return <details className="rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold"><summary>{protocolLabel(protocol)} · 未提供</summary></details>
  return <details className="rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold" open={protocol === 'local'}>
    <summary>{protocolLabel(protocol)} · {statusLabel(result.status)} · {result.targets.length} 个目标</summary>
    <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>目标项目</TableHead><TableHead>状态</TableHead>{METRICS.map(([key, name]) => <TableHead key={key}>{name}</TableHead>)}<TableHead>训练来源</TableHead><TableHead>融合权重</TableHead></TableRow></TableHeader>
      <TableBody>{result.targets.length ? result.targets.map(target => <TargetRow key={target.project} target={target} protocol={protocol}/>)
        : <TableRow><TableCell colSpan={9}>没有目标结果。</TableCell></TableRow>}</TableBody>
    </Table></div>
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
    <Button onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重试</Button>
    <Button onClick={() => navigate({ name: 'admin', view: 'experiments' })} variant="outline" type="button">返回实验列表</Button>
  </EmptyState>

  const selected = report.methods.includes(method) ? method : report.methods[0] ?? ''
  const results = reportMethod(report, selected)
  return <section>
    <AdminPageHeader title="多项目实验报告" meta={`${report.source} · ${formatDate(report.generatedUtc)}`}
      actions={<Button onClick={() => navigate({ name: 'admin', view: 'experiments' })} variant="outline" type="button">返回实验列表</Button>}/>
    <ErrorNotice>{error}</ErrorNotice>
    <div className="flex flex-wrap items-center gap-2.5 text-xs text-foreground-3">
      <span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{statusLabel(report.status)}</span>
      <span>{report.schema ?? 'schema 未提供'}</span>
      <span>{report.metricSet ?? '指标集未提供'}</span>
      <span>{report.methodCount} 种方法 · {report.protocolCount} 种口径</span>
      <span>{report.projectCount} 个项目 · 失败 {report.failureCount}</span>
    </div>
    <p className="rounded-sm border border-border-soft bg-sunken p-2.5 text-xs text-foreground-2" role="status">只读报告；宏平均不是全局最佳模型，不改变默认模型。融合权重只用各目标项目的验证段选择。</p>

    <h2 className="mt-6 mb-3 text-base font-semibold text-foreground">数据与项目</h2>
    <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>项目</TableHead><TableHead>状态</TableHead><TableHead>纳入 / 正例</TableHead><TableHead>训练 · 验证 · 测试</TableHead><TableHead>schema / 修订</TableHead><TableHead>来源</TableHead></TableRow></TableHeader>
      <TableBody>{report.report.projects.map(project => <ProjectRow key={project.name} project={project}/>)}</TableBody>
    </Table></div>
    {report.report.projects.some(project => project.limitations.length) ? <details className="mt-5 rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold">
      <summary>标签语义与限制</summary>
      <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">{report.report.projects.map(project => <div key={project.name}>
        <dt>{project.name}</dt>
        <dd>{project.labelRule ?? '标签规则未提供'}{project.limitations.length ? <small>{project.limitations.join('；')}</small> : null}</dd>
      </div>)}</dl>
    </details> : null}

    <h2 className="mt-6 mb-3 text-base font-semibold text-foreground">训练方式与目标指标</h2>
    <div className="flex flex-wrap items-end gap-3"><Select value={selected == null ? '' : String(selected)} onValueChange={nextValue => (setMethod)(nextValue === '__jit_empty__' ? '' : nextValue)}><SelectTrigger aria-label="实验方法"><SelectValue placeholder={"请选择"}/></SelectTrigger><SelectContent>{(report.methods.map(value => ({ value, label: methodLabel(value) }))).map(option => <SelectItem key={String(option.value)} value={String(option.value) || '__jit_empty__'} disabled={'disabled' in option && option.disabled === true}>{option.label}</SelectItem>)}</SelectContent></Select></div>
    <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>训练方式</TableHead><TableHead>状态</TableHead><TableHead>AP 宏平均</TableHead><TableHead>AP 方差</TableHead><TableHead>ROC-AUC</TableHead><TableHead>Recall@20%LOC</TableHead><TableHead>Popt</TableHead><TableHead>IFA</TableHead><TableHead>最差项目</TableHead></TableRow></TableHeader>
      <TableBody>{report.protocols.map(name => {
        const result = results[name]
        const worst = result?.worstProjectByPrimaryMetric
        return <TableRow key={name}>
          <TableHead>{protocolLabel(name)}</TableHead>
          <TableCell><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{statusLabel(result?.status ?? '未提供')}</span></TableCell>
          {summaryCell(result?.metrics.averagePrecision, 'macroMean')}
          {summaryCell(result?.metrics.averagePrecision, 'populationVariance')}
          {summaryCell(result?.metrics.rocAuc, 'macroMean')}
          {summaryCell(result?.metrics.recall20Loc, 'macroMean')}
          {summaryCell(result?.metrics.popt, 'macroMean')}
          {summaryCell(result?.metrics.ifa, 'macroMean')}
          <TableCell>{worst?.project ?? '—'}{worst?.value != null ? <small>{worst.value.toFixed(4)}</small> : null}</TableCell>
        </TableRow>
      })}</TableBody>
    </Table></div>
    <div className="grid gap-2.5">{report.protocols.map(name => <ProtocolSection key={name} protocol={name} result={results[name]}/>)}</div>

    <h2 className="mt-6 mb-3 text-base font-semibold text-foreground">失败记录</h2>
    {report.report.failures.length ? <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all">
      <TableHeader><TableRow><TableHead>阶段</TableHead><TableHead>方法 / 口径</TableHead><TableHead>项目</TableHead><TableHead>错误</TableHead><TableHead>训练来源</TableHead></TableRow></TableHeader>
      <TableBody>{report.report.failures.map((failure, index) => <TableRow key={index}>
        <TableCell>{failure.stage ?? '—'}</TableCell>
        <TableCell>{failure.method ? methodLabel(failure.method) : '—'}{failure.protocol ? ` · ${protocolLabel(failure.protocol)}` : ''}</TableCell>
        <TableCell>{failure.project ?? '—'}</TableCell>
        <TableCell><code>{failure.code ?? '—'}</code><small>{failure.message ?? '未提供原因'}</small></TableCell>
        <TableCell>{failure.trainingProjects.join(', ') || '—'}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : <p className="text-xs text-foreground-3">报告没有失败记录。</p>}

    <details className="mt-5 rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold">
      <summary>运行身份与边界</summary>
      <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
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
