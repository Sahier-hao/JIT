import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { useEffect, useState } from 'react'
import { ApiError } from '@/lib/apiContract'
import { fetchAdminModel, formatDate, metricReason, metricValue, valueLabel, type AdminModel } from '@/features/admin/adminContracts'
import { fetchModelBenefit, type BenefitMetric, type BenefitReport, type ModelBenefit } from '@/features/admin/benefitContracts'
import { EmptyState } from '@/components/shared/Feedback'
import { MasterDetailSkeleton } from '@/components/shared/Skeletons'

import type { Route } from '@/app/navigation'
import { ModelCardView } from '@/features/models/components/ModelCardView'
import { ModelEvaluationEvidence } from '@/features/models/components/ModelEvaluationEvidence'
import { AdminPageHeader, MetricGrid } from '@/features/admin/AdminShared'

function parameterText(parameters: unknown): string {
  if (parameters == null || typeof parameters !== 'object') return '未记录'
  return Object.entries(parameters as Record<string, unknown>)
    .filter(([key]) => !['threads', 'seed', 'hidden', 'deep', 'd_token', 'heads', 'layers'].includes(key))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(',')}]` : String(value)}`)
    .join(' · ')
}

export function AdminModelDetailPage({ modelId, navigate, expired }: {
  modelId: string
  navigate: (route: Route) => void
  expired: () => void
}) {
  const [model, setModel] = useState<AdminModel | null>(null)
  const [error, setError] = useState('')
  const backToCatalog = () => navigate({ name: 'admin', view: 'models', selectedModelId: modelId })
  useEffect(() => {
    const controller = new AbortController()
    fetchAdminModel(modelId, controller.signal).then(setModel).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) expired()
      else setError(failure instanceof Error ? failure.message : '模型详情读取失败')
    })
    return () => controller.abort()
  }, [modelId, expired])
  if (error) return <EmptyState title="模型详情不可用" description={error}><Button onClick={backToCatalog} variant="outline" type="button">返回模型列表</Button></EmptyState>
  if (!model) return <section className="grid gap-4"><AdminPageHeader title="模型详情"/><MasterDetailSkeleton label="正在校验模型与读取指标"/></section>
  const source = model.source ?? {}
  return <section>
    <AdminPageHeader title={model.name} meta={model.method}/>
    <div className="flex flex-wrap items-center gap-2"><Button onClick={backToCatalog} variant="outline" type="button">返回模型列表</Button><Button onClick={() => navigate({ name: 'admin', view: 'comparisons', models: [model.modelId] })} variant="outline" type="button">加入比较</Button></div>
    <div className="flex flex-wrap items-center gap-2.5 text-xs text-foreground-3"><span className="rounded-sm bg-soft px-1.5 py-0.5 text-[11px] text-foreground-3">{model.state === 'ready' ? '已校验' : '不可用'}</span><span>{model.enabled ? '已启用' : '已停用'}</span>{model.isDefault ? <strong>默认模型</strong> : null}</div>
    {model.card ? <ModelCardView card={model.card}/> : <><MetricGrid metrics={model.metrics}/><BenefitSection modelId={modelId} expired={expired}/></>}
    <ModelEvaluationEvidence method={model.card?.method ?? model.method ?? null} expired={expired}/>
    <div className="grid items-start gap-4 lg:grid-cols-2 [&>section]:rounded-md [&>section]:border [&>section]:border-border-soft [&>section]:bg-card [&>section]:p-card [&_h2]:text-sm [&_h2]:font-semibold">
      <section><h2>身份与能力</h2><dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
        <div><dt>模型</dt><dd><code>{model.modelId}</code></dd></div>
        <div><dt>方法</dt><dd>{model.method}</dd></div>
        <div><dt>实际参数</dt><dd>{parameterText(model.parameters)}</dd></div>
        <div><dt>所有者</dt><dd>{model.ownerUserId ? model.ownerUserId : '共享'}</dd></div>
        <div><dt>特征 schema</dt><dd>{model.featureSchemaVersion}</dd></div>
        <div><dt>业务运行</dt><dd><code>{model.runId}</code></dd></div>
        <div><dt>原产物运行</dt><dd><code>{model.artifactRunId}</code></dd></div>
        <div><dt>数据版本</dt><dd><code>{model.artifactDatasetVersion}</code></dd></div>
        <div><dt>产物位置</dt><dd><code>{model.artifactKey}</code></dd></div>
        <div><dt>指标集</dt><dd>{model.metricSet ?? '未提供'}</dd></div>
      </dl></section>
      <section><h2>训练来源</h2><dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
        <div><dt>发布者</dt><dd>{valueLabel(source.publisher)}</dd></div>
        <div><dt>来源</dt><dd>{valueLabel(source.url)}</dd></div>
        <div><dt>修订</dt><dd><code>{valueLabel(source.revision)}</code></dd></div>
        <div><dt>训练耗时</dt><dd>{model.trainingSeconds === null || model.trainingSeconds === undefined ? '未提供' : `${model.trainingSeconds.toFixed(2)} 秒`}</dd></div>
        <div><dt>阈值</dt><dd>{model.threshold ?? '未提供'}</dd></div>
      </dl></section>
    </div>
    {!model.card && model.split ? <section><h2>数据切分</h2><div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all"><TableHeader><TableRow><TableHead>分区</TableHead><TableHead>样本</TableHead><TableHead>正例</TableHead><TableHead>开始</TableHead><TableHead>结束</TableHead></TableRow></TableHeader><TableBody>{Object.entries(model.split).map(([name, raw]) => {
      const part = raw as Record<string, unknown>
      return <TableRow key={name}><TableHead>{name}</TableHead><TableCell>{valueLabel(part.count)}</TableCell><TableCell>{valueLabel(part.positiveCount)}</TableCell><TableCell>{formatDate(part.start)}</TableCell><TableCell>{formatDate(part.end)}</TableCell></TableRow>
    })}</TableBody></Table></div></section> : null}
    {!model.card ? <section><h2>限制</h2><ul className="mt-2 list-disc pl-5 text-xs leading-body text-foreground-2">{(model.limitations ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section> : null}
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
  return <TableRow>
    <TableHead>{name}</TableHead>
    <TableCell>{benefitMetric(report.recall20Loc, 'percent')}</TableCell>
    <TableCell>{benefitMetric(report.popt, 'number')}</TableCell>
    <TableCell>{benefitMetric(report.ifa, 'count')}</TableCell>
    <TableCell>{report.coverage.issuesCovered}/{report.coverage.positives}</TableCell>
    <TableCell>{report.coverage.selectedCount}</TableCell>
    <TableCell>{report.coverage.usedLoc.toLocaleString()}</TableCell>
  </TableRow>
}

function intervalText(label: string, raw: unknown) {
  const interval = (raw as { recall20LocInterval?: { low?: number | null; high?: number | null; reason?: string | null } } | undefined)?.recall20LocInterval
  if (!interval || typeof interval.low !== 'number' || typeof interval.high !== 'number') {
    return `${label}区间未定义${interval?.reason ? `（${interval.reason}）` : ''}`
  }
  return `${label} ${(interval.low * 100).toFixed(1)} 到 ${(interval.high * 100).toFixed(1)} 个百分点`
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
  if (loading) return <section className="mt-6 grid gap-3"><h2>审查收益</h2><p className="text-xs text-foreground-3" role="status">正在读取收益评估。</p></section>
  if (error) return <section className="mt-6 grid gap-3"><h2>审查收益</h2><div className="text-xs text-rose" role="alert">{error}<Button size="sm" onClick={() => setRevision(value => value + 1)} variant="outline" type="button">重试</Button></div></section>
  if (!benefit?.available) return <section className="mt-6 grid gap-3"><h2>审查收益</h2><p className="text-xs text-foreground-3">{benefit?.reason ?? '尚无该模型的收益评估报告。'}</p></section>
  const report = benefit.report!
  const existing = report.existingMetrics
  const random = report.strategies.random
  return <section className="mt-6 grid gap-3">
    <h2>审查收益</h2>
    <p className="rounded-sm border border-border-soft bg-sunken p-2.5 text-xs text-foreground-2" role="status">{report.conclusion.sentence}</p>
    <p className="text-xs leading-body text-foreground-3">测试 {report.test.records} 条提交 · {report.test.positives} 个历史标记 · 预算 {report.test.budgetLoc.toLocaleString()}/{report.test.totalLoc.toLocaleString()} 行 · 随机 {random.runs} 次（种子 {random.seed}）</p>
    <div className="overflow-x-auto rounded-md border border-border-soft"><Table className="admin-table w-full border-collapse text-xs [&_th]:border-b [&_th]:border-border-soft [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground-3 [&_thead_th]:bg-sunken [&_td]:border-b [&_td]:border-border-soft [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_tbody_tr:hover]:bg-hover [&_td_small]:mt-0.5 [&_td_small]:block [&_td_small]:text-foreground-3 [&_code]:break-all [&_td:first-child]:whitespace-nowrap [&_th:first-child]:whitespace-nowrap">
      <TableHeader><TableRow><TableHead>策略</TableHead><TableHead>Recall@20%LOC</TableHead><TableHead title="按该策略排序的归一化成本-召回面积；既有密度排序见下方对照">Popt</TableHead><TableHead>IFA</TableHead><TableHead>覆盖正例</TableHead><TableHead>选中提交</TableHead><TableHead>使用行数</TableHead></TableRow></TableHeader>
      <TableBody>
        <StrategyRow name="模型分数" report={report.strategies.model}/>
        {report.strategies.density ? <StrategyRow name="风险/成本密度" report={report.strategies.density}/> : null}
        {report.strategies.loc ? <StrategyRow name="改动量升序" report={report.strategies.loc}/> : null}
        <StrategyRow name="时间顺序" report={report.strategies.time}/>
        <TableRow><TableHead>随机（均值 ± 标准差）</TableHead>
          <TableCell><RandomMetric summary={random.recall20Loc} kind="percent"/></TableCell>
          <TableCell><RandomMetric summary={random.popt} kind="number"/></TableCell>
          <TableCell><RandomMetric summary={random.ifa} kind="count"/></TableCell>
          <TableCell><RandomMetric summary={random.coverage.issuesCovered} kind="count"/></TableCell>
          <TableCell><RandomMetric summary={random.coverage.selectedCount} kind="count"/></TableCell>
          <TableCell><RandomMetric summary={random.coverage.usedLoc} kind="count"/></TableCell>
        </TableRow>
      </TableBody>
    </Table></div>
    {report.reportVersion >= 2 ? <p className="text-xs leading-body text-foreground-3">{intervalText('模型相对风险/成本密度', report.comparisons.modelVsDensity)}；{intervalText('模型相对改动量升序', report.comparisons.modelVsLoc)}；{intervalText('模型相对时间顺序', report.comparisons.modelVsTime)}。区间为时间块重采样 95% 区间，不是在线效果。</p> : <p className="text-xs leading-body text-foreground-3">此报告为旧版本，不含成本感知基线和配对区间。</p>}
    <details className="mt-5 rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold"><summary>既有运行指标对照</summary>
      <dl className="grid gap-1 text-sm [&>div]:grid [&>div]:grid-cols-[110px_minmax(0,1fr)] [&>div]:gap-2 [&>div]:border-t [&>div]:border-border-soft [&>div]:py-1.5 [&_dt]:text-xs [&_dt]:text-foreground-3 [&_dd]:m-0 [&_dd]:break-all">
        <div><dt>AP</dt><dd>{existing && metricValue(existing, 'averagePrecision') !== null ? metricValue(existing, 'averagePrecision')!.toFixed(4) : '未提供'}</dd></div>
        <div><dt>Recall@20%LOC</dt><dd>{existing && metricValue(existing, 'recall20Loc') !== null ? `${(metricValue(existing, 'recall20Loc')! * 100).toFixed(1)}%` : '未提供'}</dd></div>
        <div><dt>Popt（既有密度序）</dt><dd>{existing && metricValue(existing, 'popt') !== null ? metricValue(existing, 'popt')!.toFixed(3) : '未提供'}</dd></div>
        <div><dt>IFA</dt><dd>{existing && metricValue(existing, 'ifa') !== null ? valueLabel(metricValue(existing, 'ifa')) : '未提供'}</dd></div>
      </dl>
      {existing && ['averagePrecision', 'recall20Loc', 'popt', 'ifa'].some(name => metricValue(existing, name) === null && metricReason(existing, name)) ? <p className="text-xs leading-body text-foreground-3">{['averagePrecision', 'recall20Loc', 'popt', 'ifa'].map(name => {
        const reason = existing && metricValue(existing, name) === null ? metricReason(existing, name) : null
        return reason ? `${name}：${reason}` : null
      }).filter(Boolean).join('；')}</p> : null}
    </details>
    <details className="mt-5 rounded-md border border-border-soft bg-card px-3.5 pb-3.5 [&>summary]:cursor-pointer [&>summary]:py-3 [&>summary]:text-sm [&>summary]:font-semibold"><summary>标签与口径限制</summary><ul className="mt-2 list-disc pl-5 text-xs leading-body text-foreground-2">{report.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    <p className="text-xs leading-body text-foreground-3">只读回顾性评估；未在测试分区调参；风险分数不是缺陷概率；不据此改变默认模型。</p>
  </section>
}
